using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.SceneManagement;

namespace FactorialAdLab.Editor
{
    /// <summary>
    /// The plugin window: sign in, compile or capture the game into a playable and upload it, and keep
    /// the plugin itself up to date (version, licence, self-update).
    /// </summary>
    public class FactorialAdLabWindow : EditorWindow
    {
        const string ApiKey = "FactorialAdLab.api";
        const string TokenKey = "FactorialAdLab.token";
        const string EmailKey = "FactorialAdLab.email";

        const string CfgKey = "FactorialAdLab.capture";
        const string CompileCfgKey = "FactorialAdLab.compile";

        string api = PluginUpdater.DefaultApi;
        bool showPlugin = true;
        string email = "";
        string password = "";
        string token = "";
        string status = "";
        CaptureSettings cfg = new CaptureSettings();
        CompileSettings compileCfg = new CompileSettings();

        [MenuItem("Factorial AdLab/Playable Builder")]
        public static void Open() => GetWindow<FactorialAdLabWindow>("Factorial AdLab");

        void OnEnable()
        {
            PluginUpdater.Changed += Repaint;
            api = EditorPrefs.GetString(ApiKey, PluginLicense.DefaultApi ?? api);
            token = EditorPrefs.GetString(TokenKey, "");
            email = EditorPrefs.GetString(EmailKey, "");
            string json = EditorPrefs.GetString(CfgKey, "");
            if (!string.IsNullOrEmpty(json)) { try { cfg = JsonUtility.FromJson<CaptureSettings>(json) ?? cfg; } catch { } }
            string cjson = EditorPrefs.GetString(CompileCfgKey, "");
            if (!string.IsNullOrEmpty(cjson)) { try { compileCfg = JsonUtility.FromJson<CompileSettings>(cjson) ?? compileCfg; } catch { } }
            if (string.IsNullOrEmpty(cfg.productName) || cfg.productName == "My Game")
                cfg.productName = Application.productName;
        }

        void OnDisable() => PluginUpdater.Changed -= Repaint;

        /// <summary>Version, licence and updates.</summary>
        void DrawPluginSection()
        {
            showPlugin = EditorGUILayout.Foldout(showPlugin, "Plugin " + AdLabBuildInfo.Version, true);
            if (!showPlugin) return;
            EditorGUI.indentLevel++;
            var lic = PluginLicense.Status;
            EditorGUILayout.HelpBox(PluginLicense.Describe(), lic == PluginLicense.State.Invalid ? MessageType.Warning : MessageType.None);
            if (!string.IsNullOrEmpty(PluginUpdater.BlockedMessage))
                EditorGUILayout.HelpBox(PluginUpdater.BlockedMessage, MessageType.Error);
            if (PluginUpdater.UpdateAvailable || PluginUpdater.Unsupported)
            {
                string notes = PluginUpdater.Notes != null && PluginUpdater.Notes.Length > 0 ? "\n• " + string.Join("\n• ", PluginUpdater.Notes) : "";
                EditorGUILayout.HelpBox(
                    (PluginUpdater.Unsupported ? "This plugin version is no longer supported — update to keep uploading. " : "") +
                    "Version " + PluginUpdater.Latest + " is available." + notes,
                    PluginUpdater.Unsupported ? MessageType.Error : MessageType.Info);
                using (new EditorGUI.DisabledScope(PluginUpdater.Updating || string.IsNullOrEmpty(token)))
                {
                    if (GUILayout.Button(PluginUpdater.Updating ? "Updating…" : "Update to " + PluginUpdater.Latest))
                        PluginUpdater.Update(api, token, s => { status = s; Repaint(); });
                }
                if (string.IsNullOrEmpty(token)) GUILayout.Label("Sign in to update (the download is licensed to you).", EditorStyles.miniLabel);
            }
            else if (!string.IsNullOrEmpty(PluginUpdater.Latest))
                GUILayout.Label("Up to date.", EditorStyles.miniLabel);
            if (!string.IsNullOrEmpty(PluginUpdater.LastError)) GUILayout.Label(PluginUpdater.LastError, EditorStyles.miniLabel);
            using (new EditorGUI.DisabledScope(PluginUpdater.Checking))
            {
                if (GUILayout.Button(PluginUpdater.Checking ? "Checking…" : "Check for updates", GUILayout.Width(160)))
                    PluginUpdater.Check(api);
            }
            EditorGUI.indentLevel--;
            GUILayout.Space(6);
        }

        void SaveCfg()
        {
            EditorPrefs.SetString(CfgKey, JsonUtility.ToJson(cfg));
            EditorPrefs.SetString(CompileCfgKey, JsonUtility.ToJson(compileCfg));
        }

        // keep the Capture button's enabled-state in sync with play mode + capture progress
        void OnInspectorUpdate() => Repaint();

        void OnGUI()
        {
            GUILayout.Space(6);
            GUILayout.Label("Factorial AdLab — Playable Builder", EditorStyles.boldLabel);
            GUILayout.Space(4);

            api = EditorGUILayout.TextField("API", api);
            GUILayout.Space(4);
            DrawPluginSection();

            if (string.IsNullOrEmpty(token))
            {
                email = EditorGUILayout.TextField("Email", email);
                password = EditorGUILayout.PasswordField("Password", password);
                using (new EditorGUI.DisabledScope(string.IsNullOrEmpty(email) || string.IsNullOrEmpty(password)))
                {
                    if (GUILayout.Button("Sign in")) SignIn();
                }
            }
            else
            {
                EditorGUILayout.HelpBox("Signed in as " + email, MessageType.Info);
                if (GUILayout.Button("Sign out"))
                {
                    token = "";
                    EditorPrefs.DeleteKey(TokenKey);
                }

                GUILayout.Space(10);
                GUILayout.Label("Active scene: " + SceneManager.GetActiveScene().name, EditorStyles.miniLabel);

                // ── Compile the game itself (Unity WebGL → single-file playable) ──
                GUILayout.Space(8);
                GUILayout.Label("Compile the game (Unity WebGL → playable)", EditorStyles.boldLabel);
                EditorGUILayout.HelpBox(
                    "Builds a size-optimised WebGL player of your game, uploads it, and the cloud compiler folds it into ONE " +
                    "self-contained HTML playable with a size breakdown. Network caps are 2–5 MB, so this suits light/hyper-casual " +
                    "games; for heavy 3D games use the capture pipeline below.",
                    MessageType.None);
                EditorGUI.BeginChangeCheck();
                compileCfg.activeSceneOnly = EditorGUILayout.Toggle("Active scene only", compileCfg.activeSceneOnly);
                compileCfg.aggressiveStripping = EditorGUILayout.Toggle("Aggressive stripping", compileCfg.aggressiveStripping);
                if (EditorGUI.EndChangeCheck()) SaveCfg();
                int varCount = VariablesScanner.Count();
                GUILayout.Label(varCount > 0
                    ? $"{varCount} [AdLabField] variable(s) found — tunable from the dashboard after compile."
                    : "No [AdLabField] variables found (mark MonoBehaviour fields to tune them from the dashboard).", EditorStyles.miniLabel);
                using (new EditorGUI.DisabledScope(Application.isPlaying || WebGLCompileUploader.Running || CaptureUploader.Running))
                {
                    if (GUILayout.Button(WebGLCompileUploader.Running ? "Compiling…" : "Build, compile & upload playable", GUILayout.Height(30)))
                    {
                        SaveCfg();
                        WebGLCompileUploader.Run(api, token, cfg, compileCfg, s => { status = s; Repaint(); }, Repaint);
                    }
                }
                if (Application.isPlaying)
                    EditorGUILayout.HelpBox("Exit Play mode to build.", MessageType.Info);

                GUILayout.Space(8);
                GUILayout.Label("Capture gameplay", EditorStyles.boldLabel);
                EditorGUI.BeginChangeCheck();
                cfg.productName = EditorGUILayout.TextField("Game name", cfg.productName);
                cfg.frames = EditorGUILayout.IntSlider("Frames", cfg.frames, 4, 240);
                cfg.fps = EditorGUILayout.IntSlider("FPS", cfg.fps, 4, 30);
                cfg.width = EditorGUILayout.IntPopup("Capture width", cfg.width,
                    new[] { "360", "540", "720" }, new[] { 360, 540, 720 });
                cfg.ctaLabel = EditorGUILayout.TextField("CTA label", cfg.ctaLabel);
                cfg.endCardSubtitle = EditorGUILayout.TextField("End-card subtitle", cfg.endCardSubtitle);
                cfg.iosUrl = EditorGUILayout.TextField("iOS store URL", cfg.iosUrl);
                cfg.androidUrl = EditorGUILayout.TextField("Android store URL", cfg.androidUrl);

                GUILayout.Space(6);
                cfg.tapZoneEnabled = EditorGUILayout.BeginToggleGroup("Tap-zone interaction", cfg.tapZoneEnabled);
                cfg.tapLabel = EditorGUILayout.TextField("Prompt", cfg.tapLabel);
                cfg.requiredTaps = EditorGUILayout.IntSlider("Required taps", cfg.requiredTaps, 1, 10);
                EditorGUILayout.LabelField("Zone (fraction of screen)", EditorStyles.miniLabel);
                cfg.tzX = EditorGUILayout.Slider("  X", cfg.tzX, 0f, 1f);
                cfg.tzY = EditorGUILayout.Slider("  Y", cfg.tzY, 0f, 1f);
                cfg.tzW = EditorGUILayout.Slider("  Width", cfg.tzW, 0.05f, 1f);
                cfg.tzH = EditorGUILayout.Slider("  Height", cfg.tzH, 0.05f, 1f);
                EditorGUILayout.EndToggleGroup();
                if (EditorGUI.EndChangeCheck()) SaveCfg();

                GUILayout.Space(4);
                float secs = cfg.frames / (float)Mathf.Max(1, cfg.fps);
                GUILayout.Label($"≈ {secs:0.0}s clip ({cfg.frames} frames @ {cfg.fps} fps)", EditorStyles.miniLabel);

                GUILayout.Space(4);
                bool playing = Application.isPlaying;
                using (new EditorGUI.DisabledScope(!playing || CaptureUploader.Running))
                {
                    if (GUILayout.Button(CaptureUploader.Running ? "Capturing…" : "Capture & upload playable", GUILayout.Height(30)))
                    {
                        SaveCfg();
                        CaptureUploader.Run(api, token, cfg, s => { status = s; Repaint(); }, Repaint);
                    }
                }
                if (!playing)
                    EditorGUILayout.HelpBox("Press Play and start gameplay, then click Capture.", MessageType.Info);
            }

            if (!string.IsNullOrEmpty(status))
            {
                GUILayout.Space(8);
                EditorGUILayout.HelpBox(status, MessageType.None);
            }
        }

        void SignIn()
        {
            status = "Signing in…";
            string body = JsonUtility.ToJson(new Creds { email = email, password = password });
            var req = new UnityWebRequest(api.TrimEnd('/') + "/api/login", "POST")
            {
                uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body)),
                downloadHandler = new DownloadHandlerBuffer(),
            };
            req.SetRequestHeader("Content-Type", "application/json");
            PluginHttp.Apply(req, null);
            var op = req.SendWebRequest();
            op.completed += _ =>
            {
                if (req.result == UnityWebRequest.Result.Success)
                {
                    var res = JsonUtility.FromJson<LoginRes>(req.downloadHandler.text);
                    token = res != null ? res.token : "";
                    if (!string.IsNullOrEmpty(token))
                    {
                        EditorPrefs.SetString(TokenKey, token);
                        EditorPrefs.SetString(ApiKey, api);
                        EditorPrefs.SetString(EmailKey, email);
                        status = "Signed in.";
                        password = "";
                    }
                    else status = "Sign in failed: unexpected response.";
                }
                else
                {
                    status = "Sign in failed: " + (PluginHttp.ServerError(req) ?? req.error + " (" + req.downloadHandler.text + ")");
                }
                req.Dispose();
                Repaint();
            };
        }

        [System.Serializable]
        class Creds { public string email; public string password; }
        [System.Serializable]
        class LoginRes { public string token; public UserObj user; }
        [System.Serializable]
        class UserObj { public string id; public string email; }
    }
}
