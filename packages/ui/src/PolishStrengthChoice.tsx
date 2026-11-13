import React from 'react';
import type { PolishStrength } from '@goltou/api-client';

export function PolishStrengthChoice({ value, disabled, change }: { value: PolishStrength; disabled: boolean; change(value: PolishStrength): void }) {
  return <div role="radiogroup" aria-label="문장 다듬기 수준">
    {([['spelling', '맞춤법·띄어쓰기만'], ['natural', '자연스럽게 다듬기']] as const).map(([level, label]) =>
      <div className="choice-row" key={level}><button role="radio" aria-checked={value === level} className={value === level ? 'chosen' : ''} disabled={disabled} onClick={() => change(level)}>{label}</button></div>)}
  </div>;
}
