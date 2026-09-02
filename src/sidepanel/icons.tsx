import type { SVGProps } from 'react'

type IconName = 'settings' | 'sun' | 'moon'

const paths: Record<IconName, string> = {
  settings: 'M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65-2-3.46-2.49 1a7.2 7.2 0 0 0-1.7-.98L15 3h-4l-.38 2.93c-.61.25-1.18.58-1.7.98l-2.49-1-2 3.46 2.11 1.65c-.04.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65 2 3.46 2.49-1c.52.4 1.09.73 1.7.98L11 21h4l.38-2.93a7.2 7.2 0 0 0 1.7-.98l2.49 1 2-3.46-2.14-1.65ZM13 15.5A3.5 3.5 0 1 1 13 8a3.5 3.5 0 0 1 0 7.5Z',
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.42-1.42M4.92 19.08l1.42-1.42m0-11.32L4.92 4.92m14.16 14.16-1.42-1.42M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  moon: 'M20.5 15.3A8.5 8.5 0 0 1 8.7 3.5 8.5 8.5 0 1 0 20.5 15.3Z',
}

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>
}
