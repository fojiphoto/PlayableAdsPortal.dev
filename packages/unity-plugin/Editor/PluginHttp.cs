using System;
using UnityEngine;
using UnityEngine.Networking;

namespace FactorialAdLab.Editor
{
    /// <summary>Headers every plugin request carries, and readable messages for the server's plugin errors.</summary>
    internal static class PluginHttp
    {
        /// <summary>Bearer token (if any), the plugin version and the download licence.</summary>
        public static void Apply(UnityWebRequest req, string token)
        {
            if (!string.IsNullOrEmpty(token)) req.SetRequestHeader("Authorization", "Bearer " + token);
            req.SetRequestHeader("X-AdLab-Plugin", AdLabBuildInfo.Version);
            string lic = PluginLicense.Header;
            if (!string.IsNullOrEmpty(lic)) req.SetRequestHeader("X-AdLab-License", lic);
        }

        [Serializable]
        class ErrorBody { public string error; public string code; }

        /// <summary>
        /// The server's error message for a failed request, or null. Outdated / banned / licence
        /// errors are also remembered by <see cref="PluginUpdater"/> so the window can explain them.
        /// </summary>
        public static string ServerError(UnityWebRequest req)
        {
            string text = req.downloadHandler != null ? req.downloadHandler.text : null;
            if (string.IsNullOrEmpty(text) || text[0] != '{') return null;
            try
            {
                var e = JsonUtility.FromJson<ErrorBody>(text);
                if (e == null) return null;
                if (e.code == "plugin-outdated" || e.code == "plugin-banned" || e.code == "plugin-license-invalid" || e.code == "plugin-license-required")
                    PluginUpdater.Blocked(e.code, e.error);
                return e.error;
            }
            catch { return null; }
        }
    }
}
