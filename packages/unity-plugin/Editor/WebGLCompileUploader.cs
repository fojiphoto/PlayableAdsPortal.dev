using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.SceneManagement;

namespace FactorialAdLab.Editor
{
    [Serializable]
    public class CompileSettings
    {
        /// <summary>Build only the active scene (a playable is one level), not the whole Build Settings list.</summary>
        public bool activeSceneOnly = true;
        /// <summary>Managed stripping High + no exceptions + strip engine code + IL2CPP size optimisation.</summary>
        public bool aggressiveStripping = true;
    }

    /// <summary>
    /// Phase 2.3 — "compile the game itself": run a size-optimised Unity WebGL build, zip it, upload it
    /// as a <b>compile job</b> (<c>POST /api/concepts/:id/compile</c>), then poll the job. The cloud
    /// compiler folds the loader/framework/wasm/data into ONE self-contained HTML playable and reports
    /// a size breakdown; it lands as a creative ready to export to every network.
    /// </summary>
    public static class WebGLCompileUploader
    {
        public static bool Running { get; private set; }

        static string apiBase, authToken, jobId;
        static Action<string> onStatus;
        static Action onDone;
        static double nextPollAt;
        static bool polling;

        public static void Run(string api, string token, CaptureSettings cfg, CompileSettings cs, Action<string> status, Action done = null)
        {
            if (Running) return;
            onStatus = status;
            onDone = done;
            if (!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.WebGL, BuildTarget.WebGL))
            {
                Report("WebGL Build Support is not installed — add it in Unity Hub ▸ Installs ▸ Add modules, then retry.");
                return;
            }
            if (EditorApplication.isPlaying)
            {
                Report("Exit Play mode before building.");
                return;
            }

            string[] scenes = cs.activeSceneOnly
                ? new[] { SceneManager.GetActiveScene().path }
                : EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray();
            if (scenes.Length == 0 || string.IsNullOrEmpty(scenes[0]))
            {
                Report("Save the active scene (or add scenes to Build Settings) first.");
                return;
            }

            Running = true;
            apiBase = api.TrimEnd('/');
            authToken = token;

            string outDir = Path.Combine(Path.GetTempPath(), "FactorialAdLab", "webgl-build");
            try
            {
                if (Directory.Exists(outDir)) Directory.Delete(outDir, true);
                Directory.CreateDirectory(outDir);
            }
            catch (Exception e)
            {
                Stop("Could not prepare the build folder: " + e.Message);
                return;
            }

            BuildReport report;
            try
            {
                Report("Building WebGL player… (the editor is blocked while Unity builds)");
                report = BuildPlayable(outDir, scenes, cs.aggressiveStripping);
            }
            catch (Exception e)
            {
                Stop("Build failed: " + e.Message);
                return;
            }

            if (report == null || report.summary.result != BuildResult.Succeeded)
            {
                Stop("Build failed (" + (report != null ? report.summary.result.ToString() : "no report") + ") — see the Console for errors.");
                return;
            }

            byte[] zip;
            try
            {
                Report($"Built {Fmt((long)report.summary.totalSize)}. Zipping…");
                zip = ZipBuild(outDir);
            }
            catch (Exception e)
            {
                Stop("Could not zip the build: " + e.Message);
                return;
            }

            Report($"Uploading {Fmt(zip.Length)}…");
            CaptureUploader.EnsureConcept(apiBase, authToken, cfg.productName, conceptId =>
            {
                if (string.IsNullOrEmpty(conceptId))
                {
                    Stop("Upload failed: could not create a concept (check sign-in).");
                    return;
                }
                var form = new List<IMultipartFormSection>
                {
                    new MultipartFormFileSection("file", zip, "build.zip", "application/zip"),
                    new MultipartFormDataSection("name", cfg.productName),
                    new MultipartFormDataSection("companyName", Application.companyName ?? ""),
                    new MultipartFormDataSection("unityVersion", Application.unityVersion ?? ""),
                };
                if (!string.IsNullOrEmpty(cfg.iosUrl)) form.Add(new MultipartFormDataSection("iosUrl", cfg.iosUrl));
                if (!string.IsNullOrEmpty(cfg.androidUrl)) form.Add(new MultipartFormDataSection("androidUrl", cfg.androidUrl));

                UnityWebRequest req = UnityWebRequest.Post($"{apiBase}/api/concepts/{conceptId}/compile", form);
                req.SetRequestHeader("Authorization", "Bearer " + authToken);
                req.SendWebRequest().completed += _ =>
                {
                    bool ok = req.result == UnityWebRequest.Result.Success;
                    string txt = req.downloadHandler.text;
                    req.Dispose();
                    if (!ok)
                    {
                        Stop("Upload failed: " + CaptureUploader.Trunc(txt));
                        return;
                    }
                    JobStart js = null;
                    try { js = JsonUtility.FromJson<JobStart>(txt); } catch { }
                    if (js == null || string.IsNullOrEmpty(js.jobId))
                    {
                        Stop("Upload failed: unexpected response.");
                        return;
                    }
                    jobId = js.jobId;
                    Report("Queued — compiling in the cloud…");
                    polling = true;
                    nextPollAt = EditorApplication.timeSinceStartup + 1.0;
                    EditorApplication.update += Poll;
                };
            });
        }

        /// <summary>
        /// Run a playable-tuned WebGL build into <paramref name="outDir"/> (Player Settings are changed for
        /// this build only and restored afterwards). Shared by the window button and the CLI entry.
        /// </summary>
        public static BuildReport BuildPlayable(string outDir, string[] scenes, bool aggressiveStripping = true)
        {
            var snapshot = PlayerSnapshot.Take();
            try
            {
                snapshot.ApplyPlayableSettings(aggressiveStripping);
                return BuildPipeline.BuildPlayer(new BuildPlayerOptions
                {
                    scenes = scenes,
                    locationPathName = outDir,
                    target = BuildTarget.WebGL,
                    targetGroup = BuildTargetGroup.WebGL,
                    options = BuildOptions.None,
                });
            }
            finally
            {
                snapshot.Restore();
            }
        }

        /// <summary>
        /// Headless entry (CI / the competitor's "Build (headless settings)"):
        /// <c>Unity -batchmode -nographics -quit -projectPath … -buildTarget WebGL
        ///   -executeMethod FactorialAdLab.Editor.WebGLCompileUploader.BuildFromCommandLine -adlabOut &lt;dir&gt; [-adlabStripping off]</c>
        /// Builds the enabled scenes (else every scene in Assets, else a fresh default scene) and exits 0/1.
        /// </summary>
        public static void BuildFromCommandLine()
        {
            string outDir = Arg("-adlabOut") ?? Path.Combine(Path.GetTempPath(), "FactorialAdLab", "webgl-build");
            bool aggressive = Arg("-adlabStripping") != "off";

            string[] scenes = EditorBuildSettings.scenes.Where(sc => sc.enabled).Select(sc => sc.path).ToArray();
            if (scenes.Length == 0)
                scenes = AssetDatabase.FindAssets("t:Scene", new[] { "Assets" }).Select(AssetDatabase.GUIDToAssetPath).OrderBy(x => x).ToArray();
            if (scenes.Length == 0)
            {
                var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                    UnityEditor.SceneManagement.NewSceneSetup.DefaultGameObjects, UnityEditor.SceneManagement.NewSceneMode.Single);
                Directory.CreateDirectory("Assets/Scenes");
                UnityEditor.SceneManagement.EditorSceneManager.SaveScene(scene, "Assets/Scenes/Playable.unity");
                scenes = new[] { "Assets/Scenes/Playable.unity" };
            }

            Debug.Log($"[FactorialAdLab] headless WebGL build → {outDir} (scenes: {string.Join(", ", scenes)}, stripping {(aggressive ? "aggressive" : "default")})");
            if (Directory.Exists(outDir)) Directory.Delete(outDir, true);
            Directory.CreateDirectory(outDir);

            var report = BuildPlayable(outDir, scenes, aggressive);
            bool ok = report != null && report.summary.result == BuildResult.Succeeded;
            Debug.Log($"[FactorialAdLab] build {(ok ? "succeeded" : "FAILED")} — {(report != null ? Fmt((long)report.summary.totalSize) : "?")}, {(report != null ? report.summary.totalErrors : -1)} errors");
            if (Application.isBatchMode) EditorApplication.Exit(ok ? 0 : 1);
        }

        static string Arg(string name)
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
            return null;
        }

        // ── job polling ──────────────────────────────────────────────────────────────────────
        static void Poll()
        {
            if (!polling) return;
            double now = EditorApplication.timeSinceStartup;
            if (now < nextPollAt) return;
            nextPollAt = now + 1.5;

            var req = UnityWebRequest.Get($"{apiBase}/api/jobs/{jobId}");
            req.SetRequestHeader("Authorization", "Bearer " + authToken);
            req.SendWebRequest().completed += _ =>
            {
                string txt = req.result == UnityWebRequest.Result.Success ? req.downloadHandler.text : null;
                req.Dispose();
                if (txt == null) return; // transient; try again next tick
                JobRes j = null;
                try { j = JsonUtility.FromJson<JobRes>(txt); } catch { }
                if (j == null) return;
                if (j.status == "done")
                {
                    EditorApplication.update -= Poll;
                    polling = false;
                    Stop(Summary(j.result));
                }
                else if (j.status == "failed")
                {
                    EditorApplication.update -= Poll;
                    polling = false;
                    Stop("Compile failed: " + (string.IsNullOrEmpty(j.error) ? "unknown error" : j.error));
                }
                else
                {
                    Report($"Compiling… {j.progress}% {(string.IsNullOrEmpty(j.label) ? "" : "· " + j.label)}");
                }
            };
        }

        static string Summary(JobResult r)
        {
            if (r == null || string.IsNullOrEmpty(r.creativeId)) return "Compiled. Open your dashboard to export.";
            var b = r.breakdown;
            string fits = r.fitsNetworks != null && r.fitsNetworks.Length > 0 ? $"fits {r.fitsNetworks.Length} networks" : "above every network cap";
            string s = $"Compiled: {Fmt(r.sizeBytes)} single-file playable ({fits}).\n" +
                       (b != null ? $"code {Fmt(b.wasm)} · assets {Fmt(b.data)} · framework {Fmt(b.framework)} · loader {Fmt(b.loader)}" : "");
            if (r.warnings != null && r.warnings.Length > 0) s += "\n• " + string.Join("\n• ", r.warnings);
            s += "\nOpen your dashboard to export to every network.";
            return s;
        }

        static void Report(string m) => onStatus?.Invoke(m);

        static void Stop(string message)
        {
            Running = false;
            polling = false;
            EditorApplication.update -= Poll;
            Report(message);
            onDone?.Invoke();
        }

        // ── zip index.html + Build/ + StreamingAssets/ (TemplateData is not needed) ──────────
        static byte[] ZipBuild(string dir)
        {
            using (var ms = new MemoryStream())
            {
                using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
                {
                    foreach (string file in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                    {
                        string rel = file.Substring(dir.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Replace('\\', '/');
                        if (rel.StartsWith("TemplateData/")) continue;
                        if (!(rel == "index.html" || rel.StartsWith("Build/") || rel.StartsWith("StreamingAssets/"))) continue;
                        var entry = zip.CreateEntry(rel, System.IO.Compression.CompressionLevel.Fastest);
                        using (var es = entry.Open())
                        using (var fs = File.OpenRead(file))
                            fs.CopyTo(es);
                    }
                }
                return ms.ToArray();
            }
        }

        static string Fmt(long n) => n >= 1024 * 1024 ? (n / (1024.0 * 1024.0)).ToString("0.00") + " MB" : (n / 1024.0).ToString("0") + " KB";

        /// <summary>Snapshot of the Player Settings we touch, so a playable build never leaves the project changed.</summary>
        class PlayerSnapshot
        {
            WebGLCompressionFormat compression;
            bool decompressionFallback, dataCaching, nameFilesAsHashes, threads, stripEngine, runInBackground;
            WebGLExceptionSupport exceptions;
            string template;
            ManagedStrippingLevel stripping;
#if UNITY_2022_2_OR_NEWER
            WebGLDebugSymbolMode debugSymbols;
            Il2CppCodeGeneration codegen;
#endif

            public static PlayerSnapshot Take()
            {
                var s = new PlayerSnapshot
                {
                    compression = PlayerSettings.WebGL.compressionFormat,
                    decompressionFallback = PlayerSettings.WebGL.decompressionFallback,
                    dataCaching = PlayerSettings.WebGL.dataCaching,
                    nameFilesAsHashes = PlayerSettings.WebGL.nameFilesAsHashes,
                    threads = PlayerSettings.WebGL.threadsSupport,
                    exceptions = PlayerSettings.WebGL.exceptionSupport,
                    template = PlayerSettings.WebGL.template,
                    stripEngine = PlayerSettings.stripEngineCode,
                    runInBackground = PlayerSettings.runInBackground,
                    stripping = PlayerSettings.GetManagedStrippingLevel(NamedBuildTarget.WebGL),
                };
#if UNITY_2022_2_OR_NEWER
                s.debugSymbols = PlayerSettings.WebGL.debugSymbolMode;
                s.codegen = PlayerSettings.GetIl2CppCodeGeneration(NamedBuildTarget.WebGL);
#endif
                return s;
            }

            /// <summary>Settings a playable needs: uncompressed output (we embed it), no caching/threads, small code.</summary>
            public void ApplyPlayableSettings(bool aggressive)
            {
                PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
                PlayerSettings.WebGL.decompressionFallback = false;
                PlayerSettings.WebGL.dataCaching = false;
                PlayerSettings.WebGL.nameFilesAsHashes = false;
                PlayerSettings.WebGL.threadsSupport = false;
                PlayerSettings.WebGL.template = "APPLICATION:Minimal";
                PlayerSettings.runInBackground = true; // an ad must keep running when the webview reports focus loss
#if UNITY_2022_2_OR_NEWER
                PlayerSettings.WebGL.debugSymbolMode = WebGLDebugSymbolMode.Off;
#endif
                if (aggressive)
                {
                    PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.None;
                    PlayerSettings.stripEngineCode = true;
                    PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.WebGL, ManagedStrippingLevel.High);
#if UNITY_2022_2_OR_NEWER
                    PlayerSettings.SetIl2CppCodeGeneration(NamedBuildTarget.WebGL, Il2CppCodeGeneration.OptimizeSize);
#endif
                }
            }

            public void Restore()
            {
                PlayerSettings.WebGL.compressionFormat = compression;
                PlayerSettings.WebGL.decompressionFallback = decompressionFallback;
                PlayerSettings.WebGL.dataCaching = dataCaching;
                PlayerSettings.WebGL.nameFilesAsHashes = nameFilesAsHashes;
                PlayerSettings.WebGL.threadsSupport = threads;
                PlayerSettings.WebGL.exceptionSupport = exceptions;
                PlayerSettings.WebGL.template = template;
                PlayerSettings.stripEngineCode = stripEngine;
                PlayerSettings.runInBackground = runInBackground;
                PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.WebGL, stripping);
#if UNITY_2022_2_OR_NEWER
                PlayerSettings.WebGL.debugSymbolMode = debugSymbols;
                PlayerSettings.SetIl2CppCodeGeneration(NamedBuildTarget.WebGL, codegen);
#endif
            }
        }

        [Serializable] class JobStart { public string jobId; public string status; }
        [Serializable] class JobRes { public string status; public int progress; public string label; public string error; public JobResult result; }
        [Serializable] class JobResult { public string creativeId; public long sizeBytes; public string[] warnings; public string[] fitsNetworks; public Breakdown breakdown; }
        [Serializable] class Breakdown { public long loader, framework, wasm, data, streamingAssets, embedded; }
    }
}
