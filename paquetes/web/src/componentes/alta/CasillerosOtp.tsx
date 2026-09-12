import { useEffect, useRef, type ClipboardEvent, type ChangeEvent, type KeyboardEvent } from 'react';

const LARGO = 6;

interface Props {
  /** Los digitos ya escritos, de cero a seis. */
  valor: string;
  onCambio: (valor: string) => void;
  /** Se dispara una vez cuando el sexto digito entra. */
  onCompleto?: (valor: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Marca los casilleros vacios como faltantes (tras un intento incompleto). */
  marcarFaltantes?: boolean;
}

/**
 * Seis casilleros, un digito cada uno, como los de una cedula. El foco avanza
 * solo, Backspace vuelve, y pegar los seis digitos de una vez los reparte. El
 * autocompletado del sistema (iOS/Android leen el WhatsApp) entra por el
 * primer casillero con los seis juntos: tambien se reparte.
 */
export function CasillerosOtp({
  valor,
  onCambio,
  onCompleto,
  disabled = false,
  autoFocus = false,
  marcarFaltantes = false,
}: Props) {
  const referencias = useRef<Array<HTMLInputElement | null>>([]);
  const digitos = valor.replace(/\D/g, '').slice(0, LARGO);

  useEffect(() => {
    if (autoFocus && !disabled) referencias.current[0]?.focus();
  }, [autoFocus, disabled]);

  function enfocar(indice: number) {
    const objetivo = Math.max(0, Math.min(LARGO - 1, indice));
    referencias.current[objetivo]?.focus();
    referencias.current[objetivo]?.select();
  }

  function aplicar(nuevo: string, enfocarEn: number) {
    const limpio = nuevo.replace(/\D/g, '').slice(0, LARGO);
    onCambio(limpio);
    enfocar(enfocarEn);
    if (limpio.length === LARGO) onCompleto?.(limpio);
  }

  function cambiar(indice: number, e: ChangeEvent<HTMLInputElement>) {
    const entrada = e.target.value.replace(/\D/g, '');
    if (!entrada) {
      // Se borro el contenido del casillero.
      aplicar(digitos.slice(0, indice) + digitos.slice(indice + 1), indice);
      return;
    }
    if (entrada.length > 1) {
      // Autocompletado o pegado dentro de un casillero: reparte desde aca.
      const combinado = (digitos.slice(0, indice) + entrada).slice(0, LARGO);
      aplicar(combinado, combinado.length);
      return;
    }
    const combinado = digitos.slice(0, indice) + entrada + digitos.slice(indice + 1);
    aplicar(combinado, indice + 1);
  }

  function tecla(indice: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digitos[indice] && indice > 0) {
      e.preventDefault();
      aplicar(digitos.slice(0, indice - 1), indice - 1);
    } else if (e.key === 'ArrowLeft' && indice > 0) {
      e.preventDefault();
      enfocar(indice - 1);
    } else if (e.key === 'ArrowRight' && indice < LARGO - 1) {
      e.preventDefault();
      enfocar(indice + 1);
    }
  }

  function pegar(e: ClipboardEvent<HTMLInputElement>) {
    const pegado = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!pegado) return;
    e.preventDefault();
    const recortado = pegado.slice(0, LARGO);
    aplicar(recortado, recortado.length);
  }

  return (
    <div
      className="flex items-center gap-2 sm:gap-3.5 md:gap-5 justify-center"
      role="group"
      aria-label="Código de verificación de seis dígitos"
    >
      {Array.from({ length: LARGO }, (_, indice) => {
        const faltante = marcarFaltantes && !digitos[indice];
        return (
          <div key={indice} className="contents">
            {indice === 3 && (
              <div
                className="hidden sm:flex items-center justify-center text-emerald-400 font-plex font-bold text-xl px-1"
                aria-hidden="true"
              >
                —
              </div>
            )}
            <input
              ref={(el) => {
                referencias.current[indice] = el;
              }}
              className={[
                'otp-official-box w-11 h-14 sm:w-14 sm:h-18 md:w-16 md:h-20 text-center text-2xl sm:text-3xl font-extrabold font-plex bg-white text-emerald-950 rounded-lg border-2 transition-all shadow-xs',
                faltante ? 'border-red-500 bg-red-50' : 'border-emerald-700/80',
                disabled ? 'opacity-60' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={indice === 0 ? LARGO : 1}
              placeholder="·"
              autoComplete={indice === 0 ? 'one-time-code' : 'off'}
              aria-label={`Dígito ${indice + 1} de ${LARGO}`}
              value={digitos[indice] ?? ''}
              disabled={disabled}
              onChange={(e) => cambiar(indice, e)}
              onKeyDown={(e) => tecla(indice, e)}
              onPaste={pegar}
              onFocus={(e) => e.target.select()}
            />
          </div>
        );
      })}
    </div>
  );
}
