using System;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace FactorialAdLab.Editor
{
    /// <summary>
    /// The licence a dashboard download carries (Editor/FactorialAdLabLicense.json) and the release
    /// file next to it (version, signing public key, API base). The licence is RSA-SHA256 signed by the
    /// server; we verify it here so a damaged or swapped licence is visible in the window, and send it
    /// with every request (X-AdLab-License) so the server can tell which download is talking.
    /// A copy installed from source has neither file and works without a licence.
    /// </summary>
    internal static class PluginLicense
    {
        public enum State { None, Valid, Invalid }

        [Serializable]
        class LicenseFile { public string wm; public string licensee; public string workspace; public string version; public string issued; public string kid; public string payload; public string sig; }

        [Serializable]
        class ReleaseFile { public string version; public string commit; public string unity; public string api; public string keys; public string kid; public string modulus; public string exponent; }

        const string LicenseName = "FactorialAdLabLicense";
        const string ReleaseName = "FactorialAdLabRelease";

        static bool loaded;
        static LicenseFile lic;
        static ReleaseFile rel;
        static State state;
        static string problem;

        public static State Status { get { Load(); return state; } }
        /// <summary>Why the licence is invalid (null when valid or absent).</summary>
        public static string Problem { get { Load(); return problem; } }
        public static string Watermark { get { Load(); return lic != null ? lic.wm : null; } }
        public static string Licensee { get { Load(); return lic != null ? lic.licensee : null; } }
        public static string Workspace { get { Load(); return lic != null ? lic.workspace : null; } }
        /// <summary>The API this download was issued by (used as the default server).</summary>
        public static string DefaultApi { get { Load(); return rel != null && !string.IsNullOrEmpty(rel.api) ? rel.api : null; } }
        /// <summary>Compact licence for the X-AdLab-License header (sent even if it fails our check — the server decides).</summary>
        public static string Header { get { Load(); return lic != null && !string.IsNullOrEmpty(lic.payload) ? lic.payload + "." + lic.sig : null; } }

        public static void Reload() { loaded = false; }

        static string ReadText(string name)
        {
            foreach (string guid in AssetDatabase.FindAssets(name))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (!path.EndsWith(name + ".json", StringComparison.OrdinalIgnoreCase)) continue;
                var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(path);
                if (asset != null) return asset.text;
            }
            return null;
        }

        static void Load()
        {
            if (loaded) return;
            loaded = true;
            lic = null; rel = null; state = State.None; problem = null;
            try
            {
                string l = ReadText(LicenseName);
                string r = ReadText(ReleaseName);
                if (!string.IsNullOrEmpty(r)) rel = JsonUtility.FromJson<ReleaseFile>(r);
                if (string.IsNullOrEmpty(l)) return;
                lic = JsonUtility.FromJson<LicenseFile>(l);
                state = Verify(out problem) ? State.Valid : State.Invalid;
            }
            catch (Exception e)
            {
                state = State.Invalid;
                problem = "could not read the licence: " + e.Message;
            }
        }

        static bool Verify(out string why)
        {
            why = null;
            if (lic == null || string.IsNullOrEmpty(lic.payload) || string.IsNullOrEmpty(lic.sig)) { why = "the licence file is incomplete"; return false; }
            if (rel == null || string.IsNullOrEmpty(rel.modulus)) { why = "the release file with the signing key is missing"; return false; }
            if (!string.IsNullOrEmpty(rel.kid) && lic.kid != rel.kid) { why = "the licence was signed with a different key"; return false; }
            if (!string.IsNullOrEmpty(AdLabBuildInfo.Watermark) && AdLabBuildInfo.Watermark != lic.wm) { why = "the licence belongs to a different download"; return false; }
            using (var rsa = RSA.Create())
            {
                rsa.ImportParameters(new RSAParameters
                {
                    Modulus = Convert.FromBase64String(rel.modulus),
                    Exponent = Convert.FromBase64String(rel.exponent),
                });
                bool ok = rsa.VerifyData(Encoding.UTF8.GetBytes(lic.payload), Convert.FromBase64String(lic.sig), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
                if (!ok) { why = "the signature does not match (the file was edited)"; return false; }
            }
            // show what was signed, not the file's plain copies (those aren't covered by the signature)
            var p = JsonUtility.FromJson<Payload>(Encoding.UTF8.GetString(FromBase64Url(lic.payload)));
            if (p == null || string.IsNullOrEmpty(p.wm)) { why = "the licence payload is unreadable"; return false; }
            if (!string.IsNullOrEmpty(AdLabBuildInfo.Watermark) && AdLabBuildInfo.Watermark != p.wm) { why = "the licence belongs to a different download"; return false; }
            lic.wm = p.wm;
            lic.licensee = p.email;
            lic.workspace = p.org;
            return true;
        }

        [Serializable]
        class Payload { public int v; public string lid; public string wm; public string uid; public string email; public string org; public string ver; public long iat; public string kid; }

        static byte[] FromBase64Url(string s)
        {
            string b = s.Replace('-', '+').Replace('_', '/');
            switch (b.Length % 4) { case 2: b += "=="; break; case 3: b += "="; break; }
            return Convert.FromBase64String(b);
        }

        /// <summary>One line for the window and the console.</summary>
        public static string Describe()
        {
            switch (Status)
            {
                case State.Valid: return "Licence " + Watermark + " · " + Licensee + (string.IsNullOrEmpty(Workspace) ? "" : " (" + Workspace + ")");
                case State.Invalid: return "Licence problem: " + Problem + ". Download the plugin again from your dashboard.";
                default: return "Installed from source (no licence file).";
            }
        }

        /// <summary>Headless check: -executeMethod FactorialAdLab.Editor.PluginLicense.PrintFromCommandLine</summary>
        public static void PrintFromCommandLine()
        {
            Reload();
            Debug.Log("[Factorial AdLab] plugin " + AdLabBuildInfo.Version + " · licence state=" + Status + " · " + Describe());
        }
    }
}
