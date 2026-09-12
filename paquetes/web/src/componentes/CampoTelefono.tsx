import { useId, useState, type FormEvent } from 'react';
import { agruparTelefono, soloDigitos } from '../utilidades/telefono';
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

  const digitos = soloDigitos(valor);
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
          value={agruparTelefono(digitos)}
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
