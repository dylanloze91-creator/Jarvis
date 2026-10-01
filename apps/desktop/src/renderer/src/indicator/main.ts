import './indicator.css';
import { indicatorBarHeights } from './levels';

interface IndicatorBridge {
  onLevel(listener: (level: number) => void): () => void;
}

const bridge = (window as unknown as { jarvisIndicator?: IndicatorBridge }).jarvisIndicator;
const bars = Array.from(document.querySelectorAll<HTMLSpanElement>('#bars span'));
const dot = document.getElementById('dot');
let history: number[] = [];

function render(): void {
  const heights = indicatorBarHeights(history, bars.length);
  bars.forEach((bar, index) => {
    bar.style.height = `${heights[index]!.toFixed(1)}px`;
  });
  const latest = history[history.length - 1] ?? 0;
  dot?.style.setProperty('--level', Math.min(1, Math.sqrt(latest / 0.25)).toFixed(3));
}

bridge?.onLevel((level) => {
  history = [...history, level].slice(-bars.length);
  render();
});
render();
