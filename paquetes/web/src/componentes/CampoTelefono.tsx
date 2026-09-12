import { useId, useState, type FormEvent } from 'react';
import estilos from './CampoTelefono.module.css';

export type EstadoCampo = 'listo' | 'enviando' | 'error';

interface Props {
  etiqueta: string;
  /** Texto de ayuda debajo del campo. Va siempre: dice la verdad del canal. */
  nota?: string;
  textoBoton: string;
  textoEnviando?: string;
  estado?: EstadoCampo;
  /** Mensaje de error: nombra el problema y como salir. */
  error?: string;
  valorInicial?: string;
  grande?: boolean;
  autoFocus?: boolean;
  onEnviar: (telefono: string) => void;
}

/**
 * Agrupa los digitos para que se puedan leer, y nada mas.
 *
 * La normalizacion de verdad vive en `clave_telefono()` en la base (migracion
 * 0015), que sabe que el 15 de celular va en el medio, despues del codigo de
 * area. Reimplementar esa regla aca seria tener dos verdades: el cliente
 * agrupa para la vista, el servidor decide.
 */
function agrupar(digitos: string): string {
  const d = digitos.slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)} ${d.slice(3)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
}

export function CampoTelefono({
  etiqueta,
  nota,
  textoBoton,
  textoEnviando = 'Enviando',
  estado = 'listo',
  error,
  valorInicial = '',
  grande = false,
  autoFocus = false,
  onEnviar,
}: Props) {
  const [valor, setValor] = useState(valorInicial);
  const idCampo = useId();
  const idNota = useId();
  const idError = useId();

  const digitos = valor.replace(/\D/g, '');
  const suficiente = digitos.length >= 10;
  const enviando = estado === 'enviando';
  const hayError = estado === 'error' && Boolean(error);

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!suficiente || enviando) return;
    onEnviar(digitos);
  }

  const descrito = [nota ? idNota : null, hayError ? idError : null]
    .filter(Boolean)
    .join(' ');

  return (
    <form className={estilos.forma} onSubmit={enviar} noValidate>
      <label className="etiqueta" htmlFor={idCampo}>
        {etiqueta}
      </label>

      <div
        className={[
          estilos.pastilla,
          grande ? estilos.grande : '',
          hayError ? estilos.pastillaError : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className={estilos.prefijo} aria-hidden="true">
          +54
        </span>
        <input
          id={idCampo}
          className={estilos.entrada}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="351 234 5678"
          aria-label="Tu número de WhatsApp, sin el cero y sin el quince"
          aria-describedby={descrito || undefined}
          aria-invalid={hayError || undefined}
          value={agrupar(digitos)}
          disabled={enviando}
          autoFocus={autoFocus}
          onChange={(e) => setValor(e.target.value)}
        />
        <button className={estilos.boton} type="submit" disabled={!suficiente || enviando}>
          {enviando ? (
            <span className={estilos.puntos}>{textoEnviando}</span>
          ) : (
            textoBoton
          )}
        </button>
      </div>

      {hayError && (
        <p className={estilos.error} id={idError} role="alert">
          <span>{error}</span>
        </p>
      )}

      {nota && (
        <p className={estilos.nota} id={idNota}>
          {nota}
        </p>
      )}
    </form>
  );
}
