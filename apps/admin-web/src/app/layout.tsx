import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/lib/query-client';

export const metadata: Metadata = {
  title: 'Tewiz Admin',
  description: 'Back-office Tewiz — KYC, top-ups, captains',
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
