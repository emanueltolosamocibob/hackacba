import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CampoTelefono } from '../componentes/CampoTelefono';
import estilos from './Agregar.module.css';

interface EstadoDeRuta {
  telefono?: string;
}

/** Agrupa para mostrar, igual que el campo. La verdad la normaliza la base. */
function mostrar(digitos: string): string {
  if (digitos.length <= 3) return digitos;
  if (digitos.length <= 7) return `${digitos.slice(0, 3)} ${digitos.slice(3)}`;
  return `${digitos.slice(0, 3)} ${digitos.slice(3, 7)} ${digitos.slice(7)}`;
}

export function Agregar() {
  const ubicacion = useLocation();
  const traido = (ubicacion.state as EstadoDeRuta | null)?.telefono ?? '';
  const [telefono, setTelefono] = useState(traido);

  const hayNumero = telefono.length >= 10;

  return (
    <main className={estilos.pagina}>
      <div className="envoltorio">
        <div className={estilos.cabecera}>
          <Link className={estilos.volver} to="/">
            <span aria-hidden="true">←</span> Inicio
          </Link>
        </div>

        <div className={estilos.cuerpo}>
          <h1 className={estilos.titulo}>Agregar FlotaBot a tu WhatsApp</h1>
          <p className={estilos.entrada}>
            Dejás tu número, recibís un código por WhatsApp y lo escribís acá. Con eso
            queda creada tu organización y seguís en el chat, donde cargás la flota y
            los vehículos.
          </p>

          <ol className={estilos.pasos}>
            <li className={estilos.paso}>
              <div className={estilos.pasoCabeza}>
                <span className={estilos.pasoNumero}>PASO 1</span>
                <h2 className={estilos.pasoTitulo}>Tu número</h2>
              </div>

              <div className={estilos.pasoContenido}>
                {hayNumero ? (
                  <div className={estilos.recibido}>
                    <span className={estilos.recibidoNumero}>+54 {mostrar(telefono)}</span>
                    <button
                      className={estilos.cambiar}
                      type="button"
                      onClick={() => setTelefono('')}
                    >
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <CampoTelefono
                    etiqueta="Tu WhatsApp"
                    textoBoton="Confirmar"
                    grande
                    autoFocus
                    nota="Sin el 0 y sin el 15. Es el número donde vas a recibir los avisos."
                    onEnviar={setTelefono}
                  />
                )}
              </div>
            </li>

            <li className={`${estilos.paso} ${estilos.pasoTrabado}`}>
              <div className={estilos.pasoCabeza}>
                <span className={estilos.pasoNumero}>PASO 2</span>
                <h2 className={estilos.pasoTitulo}>El código que te llega</h2>
              </div>

              <div className={estilos.pasoContenido}>
                <div className={estilos.codigoMarco}>
                  <input
                    className={estilos.codigo}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="······"
                    aria-label="Código de seis dígitos"
                    disabled
                  />

                  <div className={estilos.muro}>
                    <p className={estilos.muroTitulo}>
                      Este paso todavía no funciona, y no es un error tuyo.
                    </p>
                    <p className={estilos.muroTexto}>
                      El código sale por WAHA, que necesita un servidor siempre
                      encendido para mantener abierta una sesión de WhatsApp. Todavía no
                      está decidido dónde va a correr, así que no hay nada que te pueda
                      mandar un código ahora mismo.
                    </p>
                    <ul className={estilos.muroLista}>
                      <li>
                        La base que recibe el alta está terminada y verificada: crear tu
                        organización es una llamada a{' '}
                        <code className={estilos.codigoInline}>registrar_organizacion</code>.
                      </li>
                      <li>
                        Lo que falta es el canal, no el sistema. Cuando esté conectado,
                        este paso se destraba solo.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </li>
          </ol>

          <p className={estilos.pie}>
            WAHA es una API no oficial de WhatsApp. Meta puede bloquear el número, no
            hay garantía de entrega ni de tiempo de llegada, y no existe el concepto de
            plantilla aprobada. Preferimos decirlo antes que tratar una demora como si
            fuera tu problema.
          </p>
        </div>
      </div>
    </main>
  );
}
