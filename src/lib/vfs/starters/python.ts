export const pythonStarter: Record<string, string> = {
  'main.py': `"""Kalpa Python Starter — runs directly in your browser via Pyodide."""
from stats import summarize

samples = [14.2, 18.7, 21.0, 19.4, 25.1, 22.8, 17.6]
report = summarize(samples)

print("Kalpa Python Runtime Report")
print("-" * 30)
for key, val in report.items():
    print(f"{key:<10}: {val}")
`,
  'stats.py': `import statistics

def summarize(values: list[float]) -> dict[str, float]:
    if not values:
        return {"count": 0, "mean": 0.0, "median": 0.0, "stdev": 0.0}
    return {
        "count": len(values),
        "min": round(min(values), 2),
        "max": round(max(values), 2),
        "mean": round(statistics.mean(values), 2),
        "median": round(statistics.median(values), 2),
        "stdev": round(statistics.stdev(values), 2) if len(values) > 1 else 0.0,
    }
`,
  'README.md': `# Python Script Starter

Run \`main.py\` from the **Preview** tab or type \`python main.py\` in the **Terminal**.
`,
};

export const blankStarter: Record<string, string> = {
  'README.md': `# New Kalpa Project

Start creating files from the File Tree, Terminal, or Chat panel.
`,
};
