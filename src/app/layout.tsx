import type { Metadata } from "next";
import "./globals.css";
import CookieConsent from "@/components/CookieConsent";
import { AuthProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
  title: "Goldfish - גיוס משאבים חכם לעמותות",
  description: "צ'אטבוט AI לגיוס משאבים לעמותות. סריקת קולות קוראים, כתיבת הגשות, וזיכרון ארגוני.",
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    title: 'Goldfish - גיוס משאבים חכם לעמותות',
    description: 'AI-powered resource mobilization for nonprofits',
    siteName: 'Goldfish',
    locale: 'he_IL',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" className="h-full">
      <body className="min-h-full bg-bg text-text font-rubik antialiased">
        <AuthProvider>
          {children}
        </AuthProvider>
        <CookieConsent />
      </body>
    </html>
  );
}
