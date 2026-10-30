using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace FactorialAdLab.Editor
{
    /// <summary>
    /// Finds every <c>[AdLabField]</c> on MonoBehaviours in the project and describes it as the
    /// dashboard's variable schema (key, label, section, order, type, min/max/step, default). Sent
    /// with the compile upload; the dashboard renders an editor and exports inject the values.
    /// </summary>
    public static class VariablesScanner
    {
        public class Entry
        {
            public string key, displayName, section, type;
            public int order;
            public float min, max, step;
            public bool hasMin, hasMax, hasStep;
            public object def;
        }

        public static List<Entry> Scan()
        {
            var list = new List<Entry>();
            foreach (var f in TypeCache.GetFieldsWithAttribute<AdLabFieldAttribute>())
            {
                if (f.DeclaringType == null || !typeof(MonoBehaviour).IsAssignableFrom(f.DeclaringType)) continue;
                string type = TypeNameFor(f.FieldType);
                if (type == null) continue; // unsupported field type
                var a = f.GetCustomAttribute<AdLabFieldAttribute>();
                var step = f.GetCustomAttribute<AdLabFieldStepAttribute>();
                var e = new Entry
                {
                    key = f.DeclaringType.Name + "." + f.Name,
                    displayName = string.IsNullOrEmpty(a.displayName) ? ObjectNames.NicifyVariableName(f.Name) : a.displayName,
                    section = a.section ?? "",
                    order = a.order,
                    type = type,
                    hasMin = a.minValue > float.MinValue / 2, min = a.minValue,
                    hasMax = a.maxValue < float.MaxValue / 2, max = a.maxValue,
                    hasStep = step != null && step.step > 0, step = step != null ? step.step : 0,
                    def = DefaultFor(f),
                };
                list.Add(e);
            }
            return list.OrderBy(e => e.order).ThenBy(e => e.key, StringComparer.Ordinal).ToList();
        }

        public static int Count() => Scan().Count;

        public static string ManifestJson()
        {
            var sb = new StringBuilder("[");
            bool first = true;
            foreach (var e in Scan())
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append('{');
                sb.Append("\"key\":").Append(Q(e.key));
                sb.Append(",\"displayName\":").Append(Q(e.displayName));
                sb.Append(",\"section\":").Append(Q(e.section));
                sb.Append(",\"order\":").Append(e.order.ToString(CultureInfo.InvariantCulture));
                sb.Append(",\"type\":").Append(Q(e.type));
                if (e.hasMin) sb.Append(",\"min\":").Append(F(e.min));
                if (e.hasMax) sb.Append(",\"max\":").Append(F(e.max));
                if (e.hasStep) sb.Append(",\"step\":").Append(F(e.step));
                sb.Append(",\"default\":").Append(Lit(e.def));
                sb.Append('}');
            }
            return sb.Append(']').ToString();
        }

        /// <summary>Default = the value on a scene instance of the component if there is one, else the type default.</summary>
        static object DefaultFor(FieldInfo f)
        {
            try
            {
                var inst = UnityEngine.Object.FindObjectsByType(f.DeclaringType, FindObjectsInactive.Include, FindObjectsSortMode.None).FirstOrDefault();
                if (inst != null) return f.GetValue(inst);
            }
            catch { }
            var t = f.FieldType;
            if (t == typeof(string)) return "";
            if (t.IsEnum) return Enum.GetNames(t).FirstOrDefault() ?? "";
            return t.IsValueType ? Activator.CreateInstance(t) : null;
        }

        static string TypeNameFor(Type t)
        {
            if (t == typeof(bool)) return "bool";
            if (t == typeof(string) || t.IsEnum) return "string";
            if (t == typeof(int) || t == typeof(long) || t == typeof(short) || t == typeof(byte)) return "int";
            if (t == typeof(float) || t == typeof(double)) return "number";
            return null;
        }

        static string Lit(object v)
        {
            if (v == null) return "null";
            if (v is bool b) return b ? "true" : "false";
            if (v is string s) return Q(s);
            if (v is Enum) return Q(v.ToString());
            if (v is float fl) return F(fl);
            if (v is double d) return d.ToString("R", CultureInfo.InvariantCulture);
            if (v is IFormattable fmt) return fmt.ToString(null, CultureInfo.InvariantCulture);
            return Q(v.ToString());
        }

        static string F(float f) => float.IsInfinity(f) || float.IsNaN(f) ? "0" : f.ToString("R", CultureInfo.InvariantCulture);

        static string Q(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in s ?? "")
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }
    }
}
