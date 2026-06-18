import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/lib/query-client';
import { APP_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `${APP_NAME} Admin`,
  description: `Back-office ${APP_NAME} — KYC, top-ups, captains`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="antialiased min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
