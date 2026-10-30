using System;
#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace FactorialAdLab
{
    /// <summary>
    /// Mark a field as a dashboard-tunable "custom variable" (mirrors the Runtime API we
    /// recovered from the decompiled PlayableForge plugin). The build/export pipeline reads these.
    /// </summary>
    [AttributeUsage(AttributeTargets.Field, AllowMultiple = false)]
    public class AdLabFieldAttribute : Attribute
    {
        public string displayName;
        public string section;
        public float min = float.MinValue;
        public float max = float.MaxValue;

        public AdLabFieldAttribute(string displayName = null, string section = "")
        {
            this.displayName = displayName;
            this.section = section ?? "";
        }
    }

    /// <summary>
    /// Bridge to the runtime shim (window.PF) that the packager injects into every exported
    /// playable. In the Editor and on non-WebGL targets every call is a harmless no-op.
    /// </summary>
    internal static class Bridge
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] internal static extern void PF_Install();
        [DllImport("__Internal")] internal static extern void PF_GameLoaded();
        [DllImport("__Internal")] internal static extern void PF_GameStarted();
        [DllImport("__Internal")] internal static extern void PF_GameEnded();
        [DllImport("__Internal")] internal static extern void PF_LevelChanged(int level);
        [DllImport("__Internal")] internal static extern void PF_LogEvent(string name);
        [DllImport("__Internal")] internal static extern string PF_GetPlatform();
#else
        internal static void PF_Install() { }
        internal static void PF_GameLoaded() { }
        internal static void PF_GameStarted() { }
        internal static void PF_GameEnded() { }
        internal static void PF_LevelChanged(int level) { }
        internal static void PF_LogEvent(string name) { }
        internal static string PF_GetPlatform() => "editor";
#endif
    }

    /// <summary>Dev-facing playable API. Routed to the per-network CTA by the packager at export time.</summary>
    public static class Playable
    {
        /// <summary>Open the store (the right mechanism for whichever network served the ad).</summary>
        public static void InstallFullGame() => Bridge.PF_Install();
        /// <summary>Store links are configured per creative in the dashboard; the arguments are kept for source compatibility.</summary>
        public static void InstallFullGame(string iosLink, string androidLink) => Bridge.PF_Install();
        public static string GetPlatform() => Bridge.PF_GetPlatform();
        public static void SetLoadingProgress(float progress) { }
    }

    /// <summary>Lifecycle signals — some networks require them (Mintegral gameReady, Pangle gameEnd, Vungle complete) and they feed the analytics funnel.</summary>
    public static class LifeCycle
    {
        public static void GameLoaded() => Bridge.PF_GameLoaded();
        public static void GameStarted() => Bridge.PF_GameStarted();
        public static void GameEnded() => Bridge.PF_GameEnded();
        public static void LevelChanged() => Bridge.PF_LevelChanged(-1);
        public static void LevelChanged(int level) => Bridge.PF_LevelChanged(level);
    }

    /// <summary>In-playable analytics: custom events show up per name on the dashboard's Analytics page.</summary>
    public static class Analytics
    {
        public static void LogEvent(string name)
        {
            if (string.IsNullOrEmpty(name)) return;
            Bridge.PF_LogEvent(name);
        }
    }
}
