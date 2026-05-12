import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Goldfish - גיוס משאבים חכם לעמותות';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #FAFAFA 0%, #FFF5ED 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Fish icon */}
        <svg width="120" height="96" viewBox="0 0 100 80">
          <path d="M12,40 C12,40 30,14 58,14 C78,14 88,28 88,40 C88,52 78,66 58,66 C30,66 12,40 12,40 Z" fill="#EE7A30" opacity="0.9"/>
          <path d="M80,40 L96,24 L96,56 Z" fill="#EE7A30" opacity="0.7"/>
          <circle cx="34" cy="37" r="5" fill="white" opacity="0.95"/>
          <circle cx="33" cy="36" r="2.5" fill="#1A1A1A"/>
        </svg>

        <div style={{ fontSize: 64, fontWeight: 800, color: '#1A1A1A', marginTop: 20 }}>
          Goldfish
        </div>

        <div style={{ fontSize: 28, color: '#6B7280', marginTop: 12, textAlign: 'center' }}>
          AI-powered resource mobilization for nonprofits
        </div>

        <div
          style={{
            fontSize: 20,
            color: '#EE7A30',
            marginTop: 24,
            padding: '8px 24px',
            border: '2px solid #EE7A30',
            borderRadius: 24,
          }}
        >
          goldfish.co.il
        </div>
      </div>
    ),
    { ...size }
  );
}
