import { CONFIG } from './config';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const ui = document.getElementById('ui')!;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#8bc77a';
  ctx.fillRect(0, 0, innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

ui.innerHTML = `<div class="panel hello">Swords and Spears<small>Setup works · v${CONFIG.version}</small></div>`;
