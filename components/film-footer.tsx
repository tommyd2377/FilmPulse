import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { faTwitter, faTelegram, faLinkedin, faGithub } from "@fortawesome/free-brands-svg-icons"
import { Globe } from "lucide-react"

export function FilmFooter() {
  return (
    <footer className="mt-12 space-y-4 pb-8 text-center text-sm">
      <p className="font-bold text-brand">Presented by Thomas DeVito</p>
      <div className="flex items-center justify-center gap-4">
        <a href="https://thomasdevito.me/" target="_blank" rel="noopener noreferrer" aria-label="Website" className="inline-flex min-h-11 min-w-9 items-center justify-center"><Globe className="h-6 w-6" /></a>
        {[
          { href: "https://x.com/thomasfdevito", label: "X", icon: faTwitter },
          { href: "https://t.me/doubting_tom", label: "Telegram", icon: faTelegram },
          { href: "https://www.linkedin.com/in/tdevito", label: "LinkedIn", icon: faLinkedin },
          { href: "https://github.com/tommyd2377", label: "GitHub", icon: faGithub },
        ].map(link => <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" aria-label={link.label} className="inline-flex min-h-11 min-w-9 items-center justify-center"><FontAwesomeIcon icon={link.icon} className="h-6 w-6" /></a>)}
      </div>
      <p className="inline-flex items-center justify-center gap-1">Made with <svg aria-hidden="true" viewBox="0 0 24 24" className="inline-block h-[1.15em] w-[1.15em] shrink-0 translate-y-[0.06em] fill-current text-[#e25555]"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" /></svg> in NYC</p>
    </footer>
  )
}
