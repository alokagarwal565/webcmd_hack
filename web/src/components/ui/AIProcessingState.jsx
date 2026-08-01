import { useEffect, useState } from 'react';
import './AIProcessingState.css';

const STEPS = ['Reading preferences…', 'Reconciling conflicts…', 'Ranking options…'];

/**
 * The branded loading treatment shown while the organizer's aggregation or
 * options-refresh request is in flight — the product's "AI contribution
 * must be visible" moment. Purely presentational: cycles through a fixed
 * set of status lines on a timer, no new data source.
 */
export default function AIProcessingState({ active, label }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!active) {
      setStep(0);
      return;
    }
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 1400);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  return (
    <div className="ui-ai-processing" role="status">
      <span className="ui-ai-processing-glow" aria-hidden="true" />
      <div className="ui-ai-processing-dot" aria-hidden="true" />
      <span className="ui-ai-processing-text">{label ?? STEPS[step]}</span>
    </div>
  );
}
