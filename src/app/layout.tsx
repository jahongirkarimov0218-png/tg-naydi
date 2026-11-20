import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TG Naydi — Подготовь базу к рассылке в Telegram',
  description:
    'Загружаешь свою базу с номерами, получаешь тот же файл с username и типом аккаунта. Пакетная проверка с паузами, остановкой и продолжением.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased selection:bg-zinc-900 selection:text-zinc-50">
        {children}
      </body>
    </html>
  );
}
