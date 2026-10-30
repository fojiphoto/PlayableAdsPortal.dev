using System;
using System.Collections.Generic;
using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.Networking;

namespace FactorialAdLab.Editor
{
    /// <summary>Capture + upload settings, persisted in EditorPrefs by the window.</summary>
    [Serializable]
    public class CaptureSettings
    {
        public int frames = 24;      // how many frames to grab
        public int fps = 12;         // capture cadence AND playback fps of the clip
        public int width = 540;      // target capture width in px (height follows the aspect)
        public string productName = "My Game";
        public string ctaLabel = "Play Now";
        public string iosUrl = "";
        public string androidUrl = "";

        // Phase 2.2 — interaction authoring (a tap hotspot over the clip)
        public bool tapZoneEnabled = false;
        public float tzX = 0.35f, tzY = 0.45f, tzW = 0.30f, tzH = 0.20f; // normalized, top-left origin
        public string tapLabel = "Tap!";
        public int requiredTaps = 1;

        // Phase 2.2 — end-card editor
        public string endCardSubtitle = "";
    }

    /// <summary>
    /// Phase 2.1 capture pipeline. While the game is in <b>Play mode</b>, grab a short gameplay
    /// clip from the Game view, JPEG-encode the frames, and upload them to
    /// <c>/api/concepts/:id/capture</c>, where the server builds the HTML5 playable and stores it
    /// as a creative ready to export to every network.
    ///
    /// Capture runs <i>inside</i> an already-running Play session on purpose: toggling Play mode
    /// from the editor triggers a domain reload that would wipe this static state mid-capture.
    /// </summary>
    public static class CaptureUploader
    {
        const string ConceptKey = "FactorialAdLab.conceptId";

        static bool running;
        static CaptureSettings cfg;
        static string apiBase, authToken;
        static Action<string> onStatus;
        static Action onDone;
        static List<byte[]> frames;
        static double nextCaptureAt;
        static double captureInterval;
        static int targetFrames;

        public static bool Running => running;

        /// <summary>Begin capturing. No-ops unless the editor is in Play mode and not already running.</summary>
        public static void Run(string api, string token, CaptureSettings s, Action<string> status, Action done = null)
        {
            if (running) return;
            if (!Application.isPlaying)
            {
                status?.Invoke("Enter Play mode first, then capture.");
                return;
            }
            running = true;
            apiBase = api.TrimEnd('/');
            authToken = token;
            cfg = s;
            onStatus = status;
            onDone = done;
            frames = new List<byte[]>();
            targetFrames = Mathf.Clamp(s.frames, 2, 240);
            captureInterval = 1.0 / Mathf.Clamp(s.fps, 1, 60);
            nextCaptureAt = EditorApplication.timeSinceStartup + 0.3; // let the first frame settle
            EditorApplication.update += Tick;
            Report("Capturing gameplay… 0/" + targetFrames);
        }

        static void Report(string m) => onStatus?.Invoke(m);

        static void Stop(string message)
        {
            EditorApplication.update -= Tick;
            running = false;
            Report(message);
            onDone?.Invoke();
        }

        static void Tick()
        {
            try
            {
                if (!Application.isPlaying)
                {
                    Stop("Play mode ended — capture cancelled.");
                    return;
                }
                double now = EditorApplication.timeSinceStartup;
                if (now < nextCaptureAt) return;
                nextCaptureAt = now + captureInterval;

                byte[] jpg = GrabFrame(cfg.width);
                if (jpg != null) frames.Add(jpg);
                Report($"Capturing gameplay… {frames.Count}/{targetFrames}");

                if (frames.Count >= targetFrames)
                {
                    EditorApplication.update -= Tick;
                    Report("Building & uploading playable…");
                    Upload();
                }
            }
            catch (Exception e)
            {
                Stop("Capture failed: " + e.Message);
            }
        }

        /// <summary>Grab the current Game-view frame and JPEG-encode it, downscaled to targetWidth.</summary>
        static byte[] GrabFrame(int targetWidth)
        {
            Texture2D shot = ScreenCapture.CaptureScreenshotAsTexture();
            if (shot == null) return null;
            Texture2D use = shot;
            if (targetWidth > 0 && shot.width > targetWidth) use = Downscale(shot, targetWidth);
            byte[] bytes = use.EncodeToJPG(80);
            if (use != shot) UnityEngine.Object.DestroyImmediate(use);
            UnityEngine.Object.DestroyImmediate(shot);
            return bytes;
        }

        static Texture2D Downscale(Texture2D src, int w)
        {
            int h = Mathf.Max(1, Mathf.RoundToInt(src.height * (w / (float)src.width)));
            RenderTexture rt = RenderTexture.GetTemporary(w, h);
            Graphics.Blit(src, rt);
            RenderTexture prev = RenderTexture.active;
            RenderTexture.active = rt;
            Texture2D dst = new Texture2D(w, h, TextureFormat.RGB24, false);
            dst.ReadPixels(new Rect(0, 0, w, h), 0, 0);
            dst.Apply();
            RenderTexture.active = prev;
            RenderTexture.ReleaseTemporary(rt);
            return dst;
        }

        // ── upload: ensure an app+concept exist, then POST the frames ──────────────────────────

        static void Upload()
        {
            EnsureConcept(apiBase, authToken, cfg.productName, conceptId =>
            {
                if (string.IsNullOrEmpty(conceptId))
                {
                    Stop("Upload failed: could not create a concept (check sign-in).");
                    return;
                }
                var form = new List<IMultipartFormSection>();
                for (int i = 0; i < frames.Count; i++)
                    form.Add(new MultipartFormFileSection("frames", frames[i], $"frame_{i:D4}.jpg", "image/jpeg"));
                form.Add(new MultipartFormDataSection("name", cfg.productName));
                form.Add(new MultipartFormDataSection("fps", cfg.fps.ToString()));
                form.Add(new MultipartFormDataSection("endCardCta", cfg.ctaLabel));
                if (!string.IsNullOrEmpty(cfg.endCardSubtitle)) form.Add(new MultipartFormDataSection("endCardSubtitle", cfg.endCardSubtitle));
                if (!string.IsNullOrEmpty(cfg.iosUrl)) form.Add(new MultipartFormDataSection("iosUrl", cfg.iosUrl));
                if (!string.IsNullOrEmpty(cfg.androidUrl)) form.Add(new MultipartFormDataSection("androidUrl", cfg.androidUrl));
                if (cfg.tapZoneEnabled)
                {
                    // invariant-culture floats so the server parses them regardless of the editor's locale
                    var ci = System.Globalization.CultureInfo.InvariantCulture;
                    string label = "\"" + (cfg.tapLabel ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
                    string zone = "{\"x\":" + cfg.tzX.ToString(ci) + ",\"y\":" + cfg.tzY.ToString(ci) +
                                  ",\"w\":" + cfg.tzW.ToString(ci) + ",\"h\":" + cfg.tzH.ToString(ci) +
                                  ",\"label\":" + label + "}";
                    form.Add(new MultipartFormDataSection("tapZone", zone));
                    form.Add(new MultipartFormDataSection("requiredTaps", Mathf.Max(1, cfg.requiredTaps).ToString()));
                }

                UnityWebRequest req = UnityWebRequest.Post($"{apiBase}/api/concepts/{conceptId}/capture", form);
                req.SetRequestHeader("Authorization", "Bearer " + authToken);
                req.SendWebRequest().completed += _ =>
                {
                    bool ok = req.result == UnityWebRequest.Result.Success;
                    string msg = ok
                        ? $"Uploaded {frames.Count} frames. Open your dashboard to export to every network."
                        : "Upload failed: " + req.error + " (" + Trunc(req.downloadHandler.text) + ")";
                    req.Dispose();
                    Stop(msg);
                };
            });
        }

        /// <summary>Reuse a stored concept, else create "<product> (AdLab)" app + a "unity" concept. Shared with the WebGL compiler.</summary>
        internal static void EnsureConcept(string api, string token, string productName, Action<string> cb)
        {
            string cached = EditorPrefs.GetString(ConceptKey, "");
            if (!string.IsNullOrEmpty(cached)) { cb(cached); return; }

            string root = api.TrimEnd('/');
            string appBody = JsonUtility.ToJson(new AppReq { name = productName + " (AdLab)", platform = "android" });
            PostJson(token, $"{root}/api/apps", appBody, appJson =>
            {
                string appId = ExtractId(appJson);
                if (string.IsNullOrEmpty(appId)) { cb(null); return; }
                string cBody = JsonUtility.ToJson(new NameReq { name = "unity" });
                PostJson(token, $"{root}/api/apps/{appId}/concepts", cBody, cJson =>
                {
                    string cid = ExtractId(cJson);
                    if (!string.IsNullOrEmpty(cid)) EditorPrefs.SetString(ConceptKey, cid);
                    cb(cid);
                });
            });
        }

        internal static void PostJson(string token, string url, string body, Action<string> cb)
        {
            var req = new UnityWebRequest(url, "POST")
            {
                uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body)),
                downloadHandler = new DownloadHandlerBuffer(),
            };
            req.SetRequestHeader("Content-Type", "application/json");
            req.SetRequestHeader("Authorization", "Bearer " + token);
            req.SendWebRequest().completed += _ =>
            {
                string txt = req.result == UnityWebRequest.Result.Success ? req.downloadHandler.text : null;
                req.Dispose();
                cb(txt);
            };
        }

        internal static string ExtractId(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            try { return JsonUtility.FromJson<IdRes>(json)?.id; } catch { return null; }
        }

        internal static string Trunc(string s) => string.IsNullOrEmpty(s) ? "" : (s.Length > 200 ? s.Substring(0, 200) : s);

        [Serializable] class AppReq { public string name; public string platform; }
        [Serializable] class NameReq { public string name; }
        [Serializable] class IdRes { public string id; }
    }
}
