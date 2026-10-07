import { c, cB, cE, css, useTheme } from '../../cssr';

const style = c([
  cB(
    'bds-dm-collection-panel',
    css`
      display: flex;
      flex-direction: column;
      gap: 12px;
    `,
    [
      cE(
        'summary',
        css`
          padding: 6px 10px;
        `,
      ),
      cE(
        'options',
        css`
          padding: 2px 0;
        `,
      ),
      cE(
        'select',
        css`
          width: 240px;
        `,
      ),
      cE(
        'number',
        css`
          width: 76px;
        `,
      ),
      cE(
        'hint-btn',
        css`
          width: 20px;
          height: 20px;
          font-size: 12px;
        `,
      ),
      cE(
        'list',
        css`
          display: flex;
          flex-direction: column;
          gap: 2px;
          max-height: 320px;
          overflow-y: auto;
          padding: 4px;
          border: 1px solid var(--n-border-color);
          border-radius: 4px;
        `,
      ),
      cE(
        'section',
        css`
          position: sticky;
          top: 0;
          z-index: 1;
          padding: 4px 6px;
          font-size: 12px;
          opacity: 0.7;
        `,
      ),
      cE(
        'item',
        css`
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 2px 6px;
          border-radius: 4px;

          &:hover {
            background: rgba(128, 128, 128, 0.14);
          }

          &.is-current {
            box-shadow: inset 2px 0 0 var(--n-primary-color);
          }
        `,
      ),
      cE(
        'item-label',
        css`
          display: flex;
          flex: 1 1 auto;
          align-items: center;
          gap: 8px;
          min-width: 0;
          padding: 2px 0;
          cursor: pointer;
        `,
      ),
      cE(
        'item-link',
        css`
          flex: none;
          opacity: 0.7;

          &:hover {
            opacity: 1;
          }
        `,
      ),
      cE(
        'item-index',
        css`
          min-width: 24px;
          text-align: right;
          opacity: 0.6;
          font-variant-numeric: tabular-nums;
        `,
      ),
      cE(
        'item-title',
        css`
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        `,
      ),
      cE(
        'item-duration',
        css`
          opacity: 0.6;
          font-variant-numeric: tabular-nums;
        `,
      ),
      cE(
        'progress-row',
        css`
          margin-top: 4px;
        `,
      ),
      cE(
        'progress',
        css`
          width: 240px;
        `,
      ),
    ],
  ),
]);

export default function mountStyle(mountTarget) {
  useTheme('bds-dm-collection-panel-style', style, mountTarget);
}
