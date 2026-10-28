using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.SceneManagement;

namespace FactorialAdLab.Editor
{
    /// <summary>
    /// Phase 2.0 skeleton: signs in to the Factorial AdLab API and will (2.1) capture the active
    /// scene via the Recorder, build a lightweight HTML5 playable, and upload it to the pipeline.
    /// </summary>
    public class FactorialAdLabWindow : EditorWindow
    {
        const string ApiKey = "FactorialAdLab.api";
        const string TokenKey = "FactorialAdLab.token";
        const string EmailKey = "FactorialAdLab.email";

        const string CfgKey = "FactorialAdLab.capture";

        string api = "https://app.factorialstudio.dev";
        string email = "";
        string password = "";
        string token = "";
        string status = "";
        CaptureSettings cfg = new CaptureSettings();

        [MenuItem("Factorial AdLab/Playable Builder")]
        public static void Open() => GetWindow<FactorialAdLabWindow>("Factorial AdLab");

        void OnEnable()
        {
            api = EditorPrefs.GetString(ApiKey, api);
            token = EditorPrefs.GetString(TokenKey, "");
            email = EditorPrefs.GetString(EmailKey, "");
            string json = EditorPrefs.GetString(CfgKey, "");
            if (!string.IsNullOrEmpty(json)) { try { cfg = JsonUtility.FromJson<CaptureSettings>(json) ?? cfg; } catch { } }
            if (string.IsNullOrEmpty(cfg.productName) || cfg.productName == "My Game")
                cfg.productName = Application.productName;
        }

        void SaveCfg() => EditorPrefs.SetString(CfgKey, JsonUtility.ToJson(cfg));

        // keep the Capture button's enabled-state in sync with play mode + capture progress
        void OnInspectorUpdate() => Repaint();

        void OnGUI()
        {
            GUILayout.Space(6);
            GUILayout.Label("Factorial AdLab — Playable Builder", EditorStyles.boldLabel);
            GUILayout.Space(4);

            api = EditorGUILayout.TextField("API", api);

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
                    status = "Sign in failed: " + req.error + " (" + req.downloadHandler.text + ")";
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
