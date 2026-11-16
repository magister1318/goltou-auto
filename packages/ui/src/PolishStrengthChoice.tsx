import React from 'react';
import type { PolishStrength } from '@goltou/api-client';

export function PolishStrengthChoice({
  value,
  disabled,
  change,
}: {
  value: PolishStrength;
  disabled: boolean;
  change(value: PolishStrength): void;
}) {
  return (
    <div role="radiogroup" aria-label="문장 다듬기 수준">
      {(
        [
          ['spelling', '맞춤법·띄어쓰기만'],
          ['natural', '자연스럽게 다듬기'],
        ] as const
      ).map(([level, label]) => (
        <button
          className="band-row"
          key={level}
          role="radio"
          aria-checked={value === level}
          disabled={disabled}
          onClick={() => change(level)}
        >
          <span className="radio-mark" />
          <span>
            {label}
            <small>
              {level === 'spelling'
                ? '틀린 글자와 띄어쓰기만 고칩니다'
                : '어색한 문장도 다듬습니다. 숫자·날짜·가격은 바꾸지 않습니다'}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}
