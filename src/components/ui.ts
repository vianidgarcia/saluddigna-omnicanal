export const WA = 'https://wa.me/525539566729'
export const NB = ' ' // non-breaking space
export const container = 'mx-auto w-full max-w-[1200px] px-4 lg:px-8'
export const outlineBtn = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-borde-accion bg-superficie px-5 text-base font-semibold text-enlace transition-colors hover:bg-resaltado active:bg-resaltado-2'
export const link = 'inline-flex min-h-12 items-center gap-2 rounded-md px-1 text-base font-semibold text-enlace underline-offset-4 transition-colors hover:text-enlace-hover hover:underline active:text-enlace-hover'
export const solidBtn = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-accion px-6 text-base font-semibold text-white shadow-sm transition-colors hover:bg-accion-hover active:bg-accion-activo disabled:cursor-not-allowed disabled:bg-resaltado-2 disabled:text-cuerpo disabled:shadow-none'
export const chip = (on: boolean) => `min-h-12 rounded-full border px-4 text-base transition-colors ${on ? 'border-enlace bg-resaltado font-semibold text-enlace' : 'border-borde bg-superficie text-titulo hover:border-borde-accion hover:bg-resaltado active:bg-resaltado-2'}`
