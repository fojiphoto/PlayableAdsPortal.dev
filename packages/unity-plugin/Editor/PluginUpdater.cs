using System;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Networking;

namespace FactorialAdLab.Editor
{
    /// <summary>
    /// Self-update: asks the server for the latest release (<c>/api/plugin/version</c>) once per editor
    /// session and on demand; "Update" downloads a fresh signed .unitypackage for the signed-in user and
    /// imports it over this one (same asset GUIDs, so files are replaced in place).
    /// Copies installed through the Package Manager are updated there instead.
    /// </summary>
    [InitializeOnLoad]
    internal static class PluginUpdater
    {
        const string CheckedKey = "FactorialAdLab.updateChecked";
        const string ApiPref = "FactorialAdLab.api";
        public const string DefaultApi = "https://app.factorialstudio.dev";

        [Serializable]
        class VersionRes { public string version; public string releasedAt; public string[] notes; public bool updateAvailable; public bool supported; public string minVersion; }

        public static string Latest { get; private set; }
        public static string[] Notes { get; private set; } = new string[0];
        public static bool UpdateAvailable { get; private set; }
        /// <summary>The server no longer accepts this version (below its minimum).</summary>
        public static bool Unsupported { get; private set; }
        public static bool Checking { get; private set; }
        public static bool Updating { get; private set; }
        public static string LastError { get; private set; }
        /// <summary>Set when the server refused a request as outdated / banned / unlicensed.</summary>
        public static string BlockedCode { get; private set; }
        public static string BlockedMessage { get; private set; }
        public static event Action Changed;

        static PluginUpdater()
        {
            AssetDatabase.importPackageCompleted += OnPackageImported;
            EditorApplication.delayCall += () =>
            {
                if (SessionState.GetBool(CheckedKey, false)) return;
                SessionState.SetBool(CheckedKey, true);
                Check(ApiBase(), () =>
                {
                    if (UpdateAvailable)
                        Debug.Log("[Factorial AdLab] Plugin " + Latest + " is available (you have " + AdLabBuildInfo.Version + "). Open Factorial AdLab ▸ Playable Builder to update.");
                });
            };
        }

        /// <summary>
        /// After one of our packages is imported, force a re-import of the plugin folder. Unity keeps the
        /// archive's file times, and when those are older than its last refresh (an earlier download, or a
        /// server clock behind this machine's) it treats the new files as unchanged — leaving the old code
        /// compiled and the old licence loaded. Measured on Unity 6000.2.
        /// </summary>
        static void OnPackageImported(string packageName)
        {
            if (string.IsNullOrEmpty(packageName) || packageName.IndexOf("FactorialAdLab", StringComparison.OrdinalIgnoreCase) < 0) return;
            string root = PluginRoot();
            if (root == null) return;
            AssetDatabase.ImportAsset(root, ImportAssetOptions.ImportRecursive | ImportAssetOptions.ForceUpdate);
            PluginLicense.Reload();
            Debug.Log("[Factorial AdLab] Plugin package imported; refreshed " + root + ".");
        }

        /// <summary>The folder the plugin lives in (Assets/FactorialAdLab unless the user moved it).</summary>
        static string PluginRoot()
        {
            const string tail = "/Editor/AdLabBuildInfo.cs";
            foreach (string guid in AssetDatabase.FindAssets("AdLabBuildInfo t:MonoScript"))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (path.StartsWith("Assets/") && path.EndsWith(tail)) return path.Substring(0, path.Length - tail.Length);
            }
            return null;
        }

        /// <summary>The server the window is pointed at, else the one this download came from.</summary>
        public static string ApiBase() => EditorPrefs.GetString(ApiPref, PluginLicense.DefaultApi ?? DefaultApi).TrimEnd('/');

        /// <summary>True when this copy lives in Packages/ (UPM) rather than Assets/.</summary>
        public static bool InstalledAsPackage =>
            UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(PluginUpdater).Assembly) != null;

        internal static void Blocked(string code, string message)
        {
            BlockedCode = code;
            BlockedMessage = message;
            if (code == "plugin-outdated") Unsupported = true;
            Changed?.Invoke();
        }

        public static void Check(string api, Action done = null)
        {
            if (Checking) return;
            Checking = true;
            LastError = null;
            var req = UnityWebRequest.Get(api.TrimEnd('/') + "/api/plugin/version");
            PluginHttp.Apply(req, null);
            req.SendWebRequest().completed += _ =>
            {
                try
                {
                    if (req.result == UnityWebRequest.Result.Success)
                    {
                        var v = JsonUtility.FromJson<VersionRes>(req.downloadHandler.text);
                        Latest = v.version;
                        Notes = v.notes ?? new string[0];
                        UpdateAvailable = v.updateAvailable;
                        Unsupported = !v.supported;
                    }
                    else LastError = "Couldn't check for updates: " + req.error;
                }
                catch (Exception e) { LastError = "Couldn't read the update info: " + e.Message; }
                finally
                {
                    Checking = false;
                    req.Dispose();
                    Changed?.Invoke();
                    done?.Invoke();
                }
            };
        }

        /// <summary>Download this user's signed package of the latest release and import it.</summary>
        public static void Update(string api, string token, Action<string> status)
        {
            if (Updating) return;
            if (InstalledAsPackage)
            {
                status("This copy was added through the Package Manager — update it there (or remove it and import the .unitypackage from your dashboard).");
                return;
            }
            if (string.IsNullOrEmpty(token)) { status("Sign in first: updates are licensed to your account."); return; }
            Updating = true;
            string path = Path.Combine(Path.GetTempPath(), "FactorialAdLab-" + (Latest ?? "latest") + ".unitypackage");
            var req = new UnityWebRequest(api.TrimEnd('/') + "/api/plugin/download", "GET") { downloadHandler = new DownloadHandlerFile(path) { removeFileOnAbort = true } };
            PluginHttp.Apply(req, token);
            status("Downloading plugin " + (Latest ?? "") + "…");
            req.SendWebRequest().completed += _ =>
            {
                Updating = false;
                bool ok = req.result == UnityWebRequest.Result.Success;
                long code = req.responseCode;
                string err = req.error;
                req.Dispose();
                if (!ok)
                {
                    string serverMsg = null;
                    try { if (File.Exists(path)) { serverMsg = File.ReadAllText(path); File.Delete(path); } } catch { }
                    status("Update failed: " + err + (code > 0 ? " (HTTP " + code + ")" : "") + (string.IsNullOrEmpty(serverMsg) ? "" : " — " + serverMsg));
                    Changed?.Invoke();
                    return;
                }
                status("Importing plugin " + (Latest ?? "") + "… Unity will recompile.");
                PluginLicense.Reload();
                AssetDatabase.ImportPackage(path, false);
                Changed?.Invoke();
            };
        }

        /// <summary>Headless: -executeMethod FactorialAdLab.Editor.PluginUpdater.CheckFromCommandLine [-adlabApi URL]</summary>
        public static void CheckFromCommandLine()
        {
            string api = ApiBase();
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == "-adlabApi") api = args[i + 1].TrimEnd('/');
            var req = UnityWebRequest.Get(api + "/api/plugin/version");
            PluginHttp.Apply(req, null);
            var op = req.SendWebRequest();
            while (!op.isDone) System.Threading.Thread.Sleep(50);
            Debug.Log("[Factorial AdLab] version check against " + api + ": " + (req.result == UnityWebRequest.Result.Success ? req.downloadHandler.text : req.error));
            req.Dispose();
        }
    }
}
