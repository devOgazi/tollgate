import "./globals.css";
import Link from "next/link";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 min-h-screen">
        <nav className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex items-center">
                <Link href="/" className="text-xl font-bold text-gray-900">
                  Tollgate
                </Link>
              </div>
              <div className="flex items-center space-x-8">
                <Link href="/wallet" className="text-gray-600 hover:text-gray-900">
                  Wallet
                </Link>
                <Link href="/marketplace" className="text-gray-600 hover:text-gray-900">
                  Marketplace
                </Link>
                <Link href="/activity" className="text-gray-600 hover:text-gray-900">
                  Activity Feed
                </Link>
                <Link href="/analytics" className="text-gray-400 cursor-not-allowed" aria-disabled="true">
                  Analytics (Coming Soon)
                </Link>
              </div>
            </div>
          </div>
        </nav>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </body>
    </html>
  );
}
