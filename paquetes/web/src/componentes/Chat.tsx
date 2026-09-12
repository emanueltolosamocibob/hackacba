import { HILO } from '../datos/demostracion';
import estilos from './Chat.module.css';

/**
 * El hilo de ejemplo. Es una representacion de mensajes, no una captura y no
 * un cliente de chat: el link que muestra el bot se ve como lo que el bot
 * manda, pero no navega.
 */
export function Chat() {
  return (
    <div className={estilos.hilo}>
      {HILO.map((tramo) => (
        <section className={estilos.tramo} key={tramo.dia}>
          <p className={`${estilos.dia} etiqueta`}>
            <span>{tramo.dia}</span>
          </p>

          {tramo.turnos.map((turno, i) => (
            <div
              key={`${tramo.dia}-${i}`}
              className={`${estilos.turno} ${
                turno.de === 'bot' ? estilos.turnoBot : estilos.turnoDuenio
              }`}
            >
              <div
                className={`${estilos.burbuja} ${
                  turno.de === 'bot' ? estilos.burbujaBot : estilos.burbujaDuenio
                }`}
              >
                {turno.de === 'bot' && turno.encabezado && (
                  <strong className={estilos.encabezado}>{turno.encabezado}</strong>
                )}

                <p className={estilos.texto}>{turno.texto}</p>

                {turno.de === 'bot' && turno.datos && (
                  <dl className={estilos.datos}>
                    {turno.datos.map((d) => (
                      <div key={d.etiqueta} className={estilos.par}>
                        <dt className={estilos.datoEtiqueta}>{d.etiqueta}</dt>
                        <dd className={estilos.datoValor}>{d.valor}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {turno.de === 'bot' && turno.enlace && (
                  <span className={estilos.enlace}>{turno.enlace}</span>
                )}

                <p className={estilos.pie}>
                  <span>{turno.hora}</span>
                  {turno.de === 'duenio' && (
                    <span className={estilos.tilde} aria-label="entregado">
                      ✓✓
                    </span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
