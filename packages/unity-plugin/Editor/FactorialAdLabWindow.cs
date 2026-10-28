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

        string api = "https://app.factorialstudio.dev";
        string email = "";
        string password = "";
        string token = "";
        string status = "";

        [MenuItem("Factorial AdLab/Playable Builder")]
        public static void Open() => GetWindow<FactorialAdLabWindow>("Factorial AdLab");

        void OnEnable()
        {
            api = EditorPrefs.GetString(ApiKey, api);
            token = EditorPrefs.GetString(TokenKey, "");
            email = EditorPrefs.GetString(EmailKey, "");
        }

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

                GUILayout.Space(6);
                using (new EditorGUI.DisabledScope(true))
                {
                    GUILayout.Button("Capture & upload playable");
                }
                EditorGUILayout.HelpBox(
                    "Capture pipeline (Recorder → canvas playable → upload) lands in 2.1. See docs/PHASE2.md.",
                    MessageType.None);
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
