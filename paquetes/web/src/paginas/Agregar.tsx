import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CampoTelefono } from '../componentes/CampoTelefono';
import estilosCampo from '../componentes/CampoTelefono.module.css';
import { obtenerSupabase, supabaseEstaConfigurado } from '../lib/supabase';
import { agruparTelefono, aE164 } from '../utilidades/telefono';
import { codigoDeErrorFuncion, mensajeDeErrorAlta, requierePedirCodigoDeNuevo } from '../utilidades/erroresAlta';
import estilos from './Agregar.module.css';

interface EstadoDeRuta {
  telefono?: string;
}

/** El texto es siempre el mismo exista o no el numero: no hay forma de distinguirlos desde afuera. */
const NOTA_ENVIADO = 'Si el numero es valido, te llega un codigo por WhatsApp.';
const ERROR_ENVIO = 'No pudimos enviar el codigo, proba en unos minutos.';
const ERROR_CODIGO = 'Codigo incorrecto o vencido. Pedi uno nuevo.';
const ERROR_FINALIZAR = 'No pudimos completar el alta. Proba de nuevo en unos minutos.';

type Paso =
  | { tipo: 'telefono' }
  | { tipo: 'enviando' }
  | { tipo: 'codigo'; nota: string }
  | { tipo: 'verificando' }
  | { tipo: 'finalizando' }
  | { tipo: 'listo' }
  | { tipo: 'error'; mensaje: string; volverA: 'telefono' | 'codigo' };

export function Agregar() {
  const ubicacion = useLocation();
  const traido = (ubicacion.state as EstadoDeRuta | null)?.telefono ?? '';

  const [telefono, setTelefono] = useState(traido);
  const [codigo, setCodigo] = useState('');
  const [paso, setPaso] = useState<Paso>({ tipo: 'telefono' });

  const editandoTelefono = !telefono || (paso.tipo === 'error' && paso.volverA === 'telefono');

  function volverATelefono() {
    setTelefono('');
    setCodigo('');
    setPaso({ tipo: 'telefono' });
  }

  async function pedirCodigo(digitosNacionales: string) {
    const e164 = aE164(digitosNacionales);
    if (!e164) {
      setTelefono(digitosNacionales);
      setPaso({ tipo: 'error', mensaje: 'Ese numero no tiene diez digitos validos.', volverA: 'telefono' });
      return;
    }

    setTelefono(digitosNacionales);
    setCodigo('');
    setPaso({ tipo: 'enviando' });

    try {
      if (!supabaseEstaConfigurado()) throw new Error('supabase_no_configurado');
      const { error } = await obtenerSupabase().auth.signInWithOtp({ phone: e164 });
      if (error) throw error;
      setPaso({ tipo: 'codigo', nota: NOTA_ENVIADO });
    } catch {
      setPaso({ tipo: 'error', mensaje: ERROR_ENVIO, volverA: 'telefono' });
    }
  }

  async function verificarCodigo(e: FormEvent) {
    e.preventDefault();
    const e164 = aE164(telefono);
    if (!e164 || codigo.length !== 6) return;

    setPaso({ tipo: 'verificando' });

    try {
      const { error } = await obtenerSupabase().auth.verifyOtp({ phone: e164, token: codigo, type: 'sms' });
      if (error) throw error;
      await finalizarAlta();
    } catch {
      setCodigo('');
      setPaso({ tipo: 'error', mensaje: ERROR_CODIGO, volverA: 'codigo' });
    }
  }

  async function finalizarAlta() {
    setPaso({ tipo: 'finalizando' });

    try {
      const { error } = await obtenerSupabase().functions.invoke('finalizar-alta-landing', { body: {} });
      if (error) {
        const codigoError = await codigoDeErrorFuncion(error);
        setPaso({
          tipo: 'error',
          mensaje: mensajeDeErrorAlta(codigoError),
          volverA: requierePedirCodigoDeNuevo(codigoError) ? 'telefono' : 'codigo',
        });
        return;
      }
      setPaso({ tipo: 'listo' });
    } catch {
      setPaso({ tipo: 'error', mensaje: ERROR_FINALIZAR, volverA: 'codigo' });
    }
  }

  const enviando = paso.tipo === 'enviando';
  const verificando = paso.tipo === 'verificando';
  const finalizando = paso.tipo === 'finalizando';
  const mensajeError = paso.tipo === 'error' ? paso.mensaje : undefined;
  const errorEnCodigo = paso.tipo === 'error' && paso.volverA === 'codigo';
  const nota = paso.tipo === 'codigo' ? paso.nota : NOTA_ENVIADO;

  const numeroOperador = import.meta.env.VITE_WHATSAPP_OPERADOR;

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

          {paso.tipo === 'listo' ? (
            <div className={estilos.listo}>
              <p className={estilos.listoTitulo}>Listo. Seguí en WhatsApp</p>
              <p className={estilos.listoTexto}>
                Tu organización ya está creada. Para cargar la flota y los vehículos,
                continuá la conversación en WhatsApp.
              </p>
              {numeroOperador && (
                <a
                  className={estilos.enlaceWhatsapp}
                  href={`https://wa.me/${numeroOperador}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir WhatsApp
                </a>
              )}
            </div>
          ) : (
            <ol className={estilos.pasos}>
              <li className={estilos.paso}>
                <div className={estilos.pasoCabeza}>
                  <span className={estilos.pasoNumero}>PASO 1</span>
                  <h2 className={estilos.pasoTitulo}>Tu número</h2>
                </div>

                <div className={estilos.pasoContenido}>
                  {editandoTelefono ? (
                    <CampoTelefono
                      etiqueta="Tu WhatsApp"
                      textoBoton="Confirmar"
                      grande
                      autoFocus
                      nota="Sin el 0 y sin el 15. Es el número donde vas a recibir los avisos."
                      valorInicial={telefono}
                      estado={paso.tipo === 'error' ? 'error' : 'listo'}
                      error={paso.tipo === 'error' ? paso.mensaje : undefined}
                      onEnviar={pedirCodigo}
                    />
                  ) : (
                    <div className={estilos.recibido}>
                      <span className={estilos.recibidoNumero}>+54 9 {agruparTelefono(telefono)}</span>
                      {!enviando && !verificando && !finalizando && (
                        <button className={estilos.cambiar} type="button" onClick={volverATelefono}>
                          Cambiar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>

              <li className={estilos.paso}>
                <div className={estilos.pasoCabeza}>
                  <span className={estilos.pasoNumero}>PASO 2</span>
                  <h2 className={estilos.pasoTitulo}>El código que te llega</h2>
                </div>

                <div className={estilos.pasoContenido}>
                  <form className={estilos.codigoMarco} onSubmit={verificarCodigo}>
                    <input
                      className={estilos.codigo}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="······"
                      aria-label="Código de seis dígitos"
                      value={codigo}
                      disabled={editandoTelefono || enviando || verificando || finalizando}
                      onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    />

                    {finalizando ? (
                      <p className={estilos.notaCodigo}>Creando tu organización…</p>
                    ) : errorEnCodigo && mensajeError ? (
                      <p className={estilos.errorCodigo} role="alert">
                        {mensajeError}
                      </p>
                    ) : (
                      <p className={estilos.notaCodigo}>
                        {editandoTelefono ? 'Confirmá tu número para recibir el código.' : nota}
                      </p>
                    )}

                    <div className={estilos.acciones}>
                      <button
                        className={estilosCampo.boton}
                        type="submit"
                        disabled={editandoTelefono || enviando || verificando || finalizando || codigo.length !== 6}
                      >
                        {verificando ? 'Verificando…' : 'Verificar'}
                      </button>

                      {!editandoTelefono && (
                        <button
                          className={estilos.cambiar}
                          type="button"
                          disabled={enviando || verificando || finalizando}
                          onClick={() => pedirCodigo(telefono)}
                        >
                          {enviando ? 'Enviando…' : 'Reenviar código'}
                        </button>
                      )}
                    </div>
                  </form>
                </div>
              </li>
            </ol>
          )}

          <p className={estilos.pie}>
            El código llega por WhatsApp. Si no te llega, revisá el número y probá
            &quot;Reenviar código&quot; en un rato.
          </p>
        </div>
      </div>
    </main>
  );
}
