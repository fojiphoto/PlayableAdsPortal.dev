using System;

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

    /// <summary>Dev-facing playable API. Implementations are wired in at build time.</summary>
    public static class Playable
    {
        public static void InstallFullGame() { }
        public static void InstallFullGame(string iosLink, string androidLink) { }
        public static string GetPlatform() => "editor";
        public static void SetLoadingProgress(float progress) { }
    }

    public static class LifeCycle
    {
        public static void GameLoaded() { }
        public static void GameStarted() { }
        public static void GameEnded() { }
        public static void LevelChanged() { }
    }
}
