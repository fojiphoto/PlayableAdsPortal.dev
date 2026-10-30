using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Text;
using UnityEngine;
using UnityEngine.SceneManagement;
#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace FactorialAdLab
{
    // ─────────────────────────────────────────────────────────────────────────────
    //  Dev-facing runtime API. Mirrors the competitor's contract (Playable / LifeCycle /
    //  Analytics / [Field] attributes) so games port with a using-rename. In the Editor and on
    //  non-WebGL targets every call is a harmless no-op; in an exported playable the WebGL bridge
    //  (Plugins/WebGL/FactorialAdLab.jslib) routes everything to the per-network runtime shim.
    // ─────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Mark a MonoBehaviour field as a dashboard-tunable "custom variable". The plugin uploads the
    /// field list with the build; the dashboard shows an editor for it; exported playables apply
    /// the chosen values at scene load (no rebuild needed). Key = "TypeName.fieldName".
    /// </summary>
    [AttributeUsage(AttributeTargets.Field, AllowMultiple = false)]
    public class AdLabFieldAttribute : Attribute
    {
        public string displayName;
        public int order;
        public string section;
        public float minValue = float.MinValue;
        public float maxValue = float.MaxValue;

        public float Min { get => minValue; set => minValue = value; }
        public float Max { get => maxValue; set => maxValue = value; }

        public AdLabFieldAttribute(string displayName = null, int order = 0, string section = "")
        {
            this.displayName = displayName;
            this.order = order;
            this.section = section ?? "";
        }
    }

    /// <summary>Slider step for a numeric <see cref="AdLabFieldAttribute"/>.</summary>
    [AttributeUsage(AttributeTargets.Field, AllowMultiple = false)]
    public class AdLabFieldStepAttribute : Attribute
    {
        public float step;
        public AdLabFieldStepAttribute(float step) { this.step = step; }
    }

    public enum HapticFeedbackType { Light, Medium, Heavy, Success, Warning, Error, Selection }

    /// <summary>WebGL bridge to the runtime shim (window.PF). No-ops outside an exported playable.</summary>
    internal static class Bridge
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] internal static extern void PF_Install();
        [DllImport("__Internal")] internal static extern void PF_GameLoaded();
        [DllImport("__Internal")] internal static extern void PF_GameStarted();
        [DllImport("__Internal")] internal static extern void PF_GamePaused();
        [DllImport("__Internal")] internal static extern void PF_GameResumed();
        [DllImport("__Internal")] internal static extern void PF_GameEnded();
        [DllImport("__Internal")] internal static extern void PF_LevelChanged(int level);
        [DllImport("__Internal")] internal static extern void PF_LogEvent(string name, float value);
        [DllImport("__Internal")] internal static extern string PF_GetPlatform();
        [DllImport("__Internal")] internal static extern void PF_SetLoadingProgress(float progress);
        [DllImport("__Internal")] internal static extern string PF_GetPreferredLanguage();
        [DllImport("__Internal")] internal static extern string PF_GetPreferredLanguagesJson();
        [DllImport("__Internal")] internal static extern void PF_Haptic(string type);
        [DllImport("__Internal")] internal static extern string PF_GetVarsJson();
        [DllImport("__Internal")] internal static extern void PF_RegisterLifecycle(string gameObjectName);
#else
        internal static void PF_Install() { }
        internal static void PF_GameLoaded() { }
        internal static void PF_GameStarted() { }
        internal static void PF_GamePaused() { }
        internal static void PF_GameResumed() { }
        internal static void PF_GameEnded() { }
        internal static void PF_LevelChanged(int level) { }
        internal static void PF_LogEvent(string name, float value) { }
        internal static string PF_GetPlatform() => "editor";
        internal static void PF_SetLoadingProgress(float progress) { }
        internal static string PF_GetPreferredLanguage() => "en-US";
        internal static string PF_GetPreferredLanguagesJson() => "[\"en-US\"]";
        internal static void PF_Haptic(string type) { }
        internal static string PF_GetVarsJson() => "{}";
        internal static void PF_RegisterLifecycle(string gameObjectName) { }
#endif
    }

    /// <summary>Store CTA, platform, loading progress, language.</summary>
    public static class Playable
    {
        /// <summary>Open the store through whichever mechanism the serving network requires.</summary>
        public static void InstallFullGame() => Bridge.PF_Install();
        /// <summary>Store links are configured per creative in the dashboard; the arguments are kept for source compatibility.</summary>
        public static void InstallFullGame(string iosLink, string androidLink) => Bridge.PF_Install();
        /// <summary>"ios" | "android" | "web" in a playable, "editor" in the Editor.</summary>
        public static string GetPlatform() => Bridge.PF_GetPlatform();
        /// <summary>Drive the branded preloader's progress bar (0–1); 1 hides it.</summary>
        public static void SetLoadingProgress(float progress) => Bridge.PF_SetLoadingProgress(Mathf.Clamp01(progress));
        public static string GetPreferredLanguage() => Bridge.PF_GetPreferredLanguage();
        public static string[] GetPreferredLanguages()
        {
            var parsed = MiniJson.ParseStringArray(Bridge.PF_GetPreferredLanguagesJson());
            return parsed.Length > 0 ? parsed : new[] { "en-US" };
        }
    }

    /// <summary>
    /// Lifecycle signals: some networks require them (Mintegral gameReady, Pangle gameEnd, Vungle
    /// complete), they feed the analytics funnel, and OnPause/OnResume mirror the ad container's
    /// viewability so you can stop audio/physics while the ad is off-screen.
    /// </summary>
    public static class LifeCycle
    {
        public static event Action OnPause;
        public static event Action OnResume;

        public static void GameLoaded() => Bridge.PF_GameLoaded();
        public static void GameStarted() => Bridge.PF_GameStarted();
        public static void GamePaused() => Bridge.PF_GamePaused();
        public static void GameResumed() => Bridge.PF_GameResumed();
        public static void GameUpdated(params object[] details) { }
        public static void GameEnded() => Bridge.PF_GameEnded();
        public static void GameEnded(params object[] details) => GameEnded();
        public static void LevelChanged() => Bridge.PF_LevelChanged(-1);
        public static void LevelChanged(int level) => Bridge.PF_LevelChanged(level);
        public static void LevelChanged(params object[] details)
        {
            int level = -1;
            if (details != null && details.Length > 0 && details[0] != null) int.TryParse(details[0].ToString(), out level);
            Bridge.PF_LevelChanged(level);
        }
        public static void HapticTriggered(HapticFeedbackType type) => Bridge.PF_Haptic(type.ToString().ToLowerInvariant());

        internal static void RaisePause() => OnPause?.Invoke();
        internal static void RaiseResume() => OnResume?.Invoke();
    }

    /// <summary>In-playable analytics: events show up per name (with value totals) on the dashboard.</summary>
    public static class Analytics
    {
        public enum EventType { LevelStart, LevelWon, LevelFailed, LevelRetry, EndCardShown, TutorialStarted, TutorialComplete, CUSTOM }

        /// <summary>AppLovin's standard challenge events, named as the network expects.</summary>
        public static class Applovin
        {
            public static void LogChallengeStarted() => LogEvent("CHALLENGE_STARTED");
            public static void LogChallengeFailed() => LogEvent("CHALLENGE_FAILED");
            public static void LogChallengeRetry() => LogEvent("CHALLENGE_RETRY");
            public static void LogChallengePass25() => LogEvent("CHALLENGE_PASS_25");
            public static void LogChallengePass50() => LogEvent("CHALLENGE_PASS_50");
            public static void LogChallengePass75() => LogEvent("CHALLENGE_PASS_75");
            public static void LogChallengeSolved() => LogEvent("CHALLENGE_SOLVED");
        }

        public static void LogEvent(string name, int value = 0) => LogEvent(name, (float)value);
        public static void LogEvent(string name, float value)
        {
            if (string.IsNullOrEmpty(name)) return;
            Bridge.PF_LogEvent(name, value);
        }
        public static void LogEvent(EventType type, int value = 0) => LogEvent(type.ToString(), value);
    }

    /// <summary>
    /// Dashboard-tunable variables. Values come from the exported playable's <c>PF.vars</c>; fields
    /// marked <see cref="AdLabFieldAttribute"/> on scene MonoBehaviours are set automatically at
    /// scene load. Read ad-hoc values with <see cref="Get{T}"/>.
    /// </summary>
    public static class Variables
    {
        static Dictionary<string, object> values;

        public static IReadOnlyDictionary<string, object> All => Load();

        static Dictionary<string, object> Load()
        {
            if (values != null) return values;
            try { values = MiniJson.ParseFlatObject(Bridge.PF_GetVarsJson()); }
            catch { values = new Dictionary<string, object>(); }
            return values;
        }

        public static bool Has(string key) => Load().ContainsKey(key);

        public static T Get<T>(string key, T fallback)
        {
            if (!Load().TryGetValue(key, out var raw) || raw == null) return fallback;
            try { return (T)Convert(raw, typeof(T)); } catch { return fallback; }
        }

        /// <summary>Apply matching variables ("TypeName.fieldName") to the target's [AdLabField] fields.</summary>
        public static void Apply(object target)
        {
            if (target == null) return;
            var vars = Load();
            if (vars.Count == 0) return;
            var type = target.GetType();
            foreach (var f in type.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic))
            {
                var attr = f.GetCustomAttribute<AdLabFieldAttribute>();
                if (attr == null) continue;
                if (!vars.TryGetValue(type.Name + "." + f.Name, out var raw) || raw == null) continue;
                try
                {
                    object v = Convert(raw, f.FieldType);
                    if (v is float fl) v = Mathf.Clamp(fl, attr.minValue, attr.maxValue);
                    else if (v is int i && attr.minValue > float.MinValue) v = Mathf.Clamp(i, (int)attr.minValue, (int)attr.maxValue);
                    f.SetValue(target, v);
                }
                catch (Exception e) { Debug.LogWarning($"[FactorialAdLab] variable {type.Name}.{f.Name}: {e.Message}"); }
            }
        }

        static object Convert(object raw, Type to)
        {
            if (to.IsInstanceOfType(raw)) return raw;
            if (to.IsEnum) return raw is string s ? Enum.Parse(to, s, true) : Enum.ToObject(to, System.Convert.ToInt32(raw, CultureInfo.InvariantCulture));
            if (to == typeof(bool)) return raw is bool b ? b : raw is string bs ? bs == "true" || bs == "1" : System.Convert.ToDouble(raw, CultureInfo.InvariantCulture) != 0;
            if (to == typeof(string)) return System.Convert.ToString(raw, CultureInfo.InvariantCulture);
            return System.Convert.ChangeType(raw, to, CultureInfo.InvariantCulture);
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Boot()
        {
            var go = new GameObject("FactorialAdLab");
            UnityEngine.Object.DontDestroyOnLoad(go);
            go.hideFlags = HideFlags.HideInHierarchy;
            go.AddComponent<AdLabBridge>();
            Bridge.PF_RegisterLifecycle(go.name);
            SceneManager.sceneLoaded += (_, __) => ApplyToScene();
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void ApplyToScene()
        {
            if (Load().Count == 0) return;
            foreach (var mb in UnityEngine.Object.FindObjectsByType<MonoBehaviour>(FindObjectsInactive.Include, FindObjectsSortMode.None))
                if (mb != null) Apply(mb);
        }
    }

    /// <summary>Receives container pause/resume from the shim (via SendMessage) and raises LifeCycle events.</summary>
    [AddComponentMenu("")]
    public class AdLabBridge : MonoBehaviour
    {
        public void __OnPause() => LifeCycle.RaisePause();
        public void __OnResume() => LifeCycle.RaiseResume();
    }

    /// <summary>Just enough JSON for `{"k": 1, "s": "x", "b": true}` and `["a","b"]` (JsonUtility can't do dictionaries).</summary>
    internal static class MiniJson
    {
        public static Dictionary<string, object> ParseFlatObject(string json)
        {
            var d = new Dictionary<string, object>();
            if (string.IsNullOrEmpty(json)) return d;
            int i = 0;
            SkipWs(json, ref i);
            if (i >= json.Length || json[i] != '{') return d;
            i++;
            while (true)
            {
                SkipWs(json, ref i);
                if (i >= json.Length) break;
                if (json[i] == '}') break;
                if (json[i] == ',') { i++; continue; }
                string key = ParseString(json, ref i);
                SkipWs(json, ref i);
                if (i < json.Length && json[i] == ':') i++;
                SkipWs(json, ref i);
                d[key] = ParseValue(json, ref i);
            }
            return d;
        }

        public static string[] ParseStringArray(string json)
        {
            var list = new List<string>();
            if (string.IsNullOrEmpty(json)) return list.ToArray();
            int i = 0;
            SkipWs(json, ref i);
            if (i >= json.Length || json[i] != '[') return list.ToArray();
            i++;
            while (i < json.Length)
            {
                SkipWs(json, ref i);
                if (i >= json.Length || json[i] == ']') break;
                if (json[i] == ',') { i++; continue; }
                var v = ParseValue(json, ref i);
                if (v != null) list.Add(v.ToString());
            }
            return list.ToArray();
        }

        static object ParseValue(string s, ref int i)
        {
            if (i >= s.Length) return null;
            char c = s[i];
            if (c == '"') return ParseString(s, ref i);
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
            if (s.Length - i >= 5 && string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
            int start = i;
            while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '-' || s[i] == '+' || s[i] == '.' || s[i] == 'e' || s[i] == 'E')) i++;
            if (i == start) { i++; return null; } // skip something we don't understand
            string num = s.Substring(start, i - start);
            if (num.IndexOfAny(new[] { '.', 'e', 'E' }) < 0 && long.TryParse(num, NumberStyles.Integer, CultureInfo.InvariantCulture, out long l)) return l;
            double.TryParse(num, NumberStyles.Float, CultureInfo.InvariantCulture, out double dbl);
            return dbl;
        }

        static string ParseString(string s, ref int i)
        {
            var sb = new StringBuilder();
            if (i < s.Length && s[i] == '"') i++;
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') break;
                if (c == '\\' && i < s.Length)
                {
                    char e = s[i++];
                    switch (e)
                    {
                        case 'n': sb.Append('\n'); break;
                        case 't': sb.Append('\t'); break;
                        case 'r': sb.Append('\r'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'u':
                            if (i + 4 <= s.Length) { sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber)); i += 4; }
                            break;
                        default: sb.Append(e); break;
                    }
                }
                else sb.Append(c);
            }
            return sb.ToString();
        }

        static void SkipWs(string s, ref int i) { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }
    }
}
