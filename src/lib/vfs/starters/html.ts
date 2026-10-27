export const htmlStarter: Record<string, string> = {
  'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Static Web Starter</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="card">
    <p class="eyebrow">HTML · CSS · JS</p>
    <h1>Counter &amp; Event Studio</h1>
    <p class="subtitle">Edit <code>index.html</code>, <code>styles.css</code>, or <code>app.js</code> to update instantly.</p>
    <div class="counter-row">
      <button id="dec" type="button">−</button>
      <span id="value">0</span>
      <button id="inc" type="button">+</button>
    </div>
    <button id="reset" class="ghost" type="button">Reset counter</button>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
  'styles.css': `* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #08080f;
  color: #f4f4fa;
  font-family: system-ui, -apple-system, sans-serif;
}
.card {
  width: 100%;
  max-width: 420px;
  padding: 28px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  text-align: center;
}
.eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  color: #ffb86b;
  font-weight: 600;
}
h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: -0.02em; }
.subtitle { margin: 0 0 24px; font-size: 14px; color: #9a9bb4; line-height: 1.5; }
code { color: #ff5f9e; }
.counter-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-bottom: 16px;
}
.counter-row button {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: #7c5cff;
  color: white;
  font-size: 22px;
  cursor: pointer;
}
#value {
  font-size: 36px;
  font-weight: 700;
  min-width: 64px;
  font-variant-numeric: tabular-nums;
}
.ghost {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #9a9bb4;
  padding: 8px 14px;
  border-radius: 10px;
  cursor: pointer;
}
`,
  'app.js': `let count = 0;
const valueEl = document.getElementById('value');
const render = () => {
  valueEl.textContent = String(count);
  console.log('Counter updated:', count);
};

document.getElementById('inc').addEventListener('click', () => {
  count += 1;
  render();
});
document.getElementById('dec').addEventListener('click', () => {
  count -= 1;
  render();
});
document.getElementById('reset').addEventListener('click', () => {
  count = 0;
  render();
});
`,
};
