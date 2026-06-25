export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-gray-900 dark:bg-black border-t border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-sm">
                MW
              </div>
              <span className="text-lg font-semibold text-white">
                Modern<span className="text-amber-400">Web</span> Studio
              </span>
            </div>
            <p className="text-sm text-gray-400 max-w-md leading-relaxed mb-4">
              We build modern, responsive websites for GTA-based small businesses. 
              Professional quality, fast turnaround, affordable pricing — powered by 
              AI-assisted development and modern design.
            </p>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">📍 Greater Toronto Area</span>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">Links</h4>
            <ul className="space-y-2.5">
              {[
                { label: "Home", href: "#hero" },
                { label: "Services", href: "#services" },
                { label: "Our Process", href: "#process" },
                { label: "Contact", href: "#contact" },
              ].map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="text-sm text-gray-400 hover:text-amber-400 transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">Contact</h4>
            <ul className="space-y-2.5">
              <li>
                <a
                  href="mailto:hello@modernwebstudio.ca"
                  className="text-sm text-gray-400 hover:text-amber-400 transition-colors"
                >
                  hello@modernwebstudio.ca
                </a>
              </li>
              <li className="text-sm text-gray-400">
                GTA, Ontario, Canada
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 sm:mt-14 pt-6 sm:pt-8 border-t border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-500">
            &copy; {currentYear} ModernWeb Studio. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-600">
              Proudly serving the GTA
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}