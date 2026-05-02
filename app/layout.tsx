import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Standardization Test',
  description: 'Anthropometric standardization test workflow for Taimaka enumerators',
};

// Inline boot script: read the persisted theme before paint and set
// data-theme on <html>. Avoids the flash-of-wrong-theme after a refresh.
const themeBootScript = `(() => {
  try {
    var t = localStorage.getItem('std-theme');
    if (t === 'dark' || t === 'light') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch (e) {}
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
