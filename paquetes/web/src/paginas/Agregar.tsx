import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FormularioTelefono, type EstadoDeAlta } from '../componentes/landing/FormularioTelefono';
import { CasillerosOtp } from '../componentes/alta/CasillerosOtp';
import { IconoFlecha, IconoWhatsApp } from '../componentes/landing/iconos';
import { obtenerSupabase, supabaseEstaConfigurado } from '../lib/supabase';
import { agruparTelefono, aE164 } from '../utilidades/telefono';
import { codigoDeErrorFuncion, mensajeDeErrorAlta, requierePedirCodigoDeNuevo } from '../utilidades/erroresAlta';
import '../componentes/landing/landing.css';
import '../componentes/alta/alta.css';

/** El texto es siempre el mismo exista o no el numero: no hay forma de distinguirlos desde afuera. */
const NOTA_ENVIADO = 'Si el número es válido, te llega un código por WhatsApp.';
const ERROR_ENVIO = 'No pudimos enviar el código, probá en unos minutos.';
const ERROR_CODIGO = 'Código incorrecto o vencido. Pedí uno nuevo.';
const ERROR_FINALIZAR = 'No pudimos completar el alta. Probá de nuevo en unos minutos.';
const ERROR_INCOMPLETO = 'Faltan dígitos: el código tiene seis.';

/** Segundos que hay que esperar para reenviar: evita la doble tanda de mensajes. */
const ESPERA_REENVIO = 45;

type Paso =
  | { tipo: 'telefono' }
  | { tipo: 'enviando' }
  | { tipo: 'codigo'; nota: string }
  | { tipo: 'verificando' }
  | { tipo: 'finalizando' }
  | { tipo: 'listo' }
  | { tipo: 'error'; mensaje: string; volverA: 'telefono' | 'codigo' };

/** Cuenta regresiva del reenvio: `iniciar()` la pone en marcha, `restante` baja a cero. */
function useEsperaReenvio() {
  const [restante, setRestante] = useState(0);

  useEffect(() => {
    if (restante <= 0) return;
    const temporizador = window.setTimeout(() => setRestante((r) => r - 1), 1000);
    return () => window.clearTimeout(temporizador);
  }, [restante]);

  return { restante, iniciar: () => setRestante(ESPERA_REENVIO) };
}

function formatearEspera(segundos: number): string {
  return `00:${segundos < 10 ? '0' : ''}${segundos}`;
}

function Spinner() {
  return (
    <svg className="alta-giro h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

export function Agregar() {
  const ubicacion = useLocation();
  const traido = (ubicacion.state as EstadoDeAlta | null) ?? {};

  const [telefono, setTelefono] = useState(traido.telefono ?? '');
  const [codigo, setCodigo] = useState('');
  const [marcarFaltantes, setMarcarFaltantes] = useState(false);
  const [paso, setPaso] = useState<Paso>(() => {
    if (traido.telefono && traido.codigoEnviado) return { tipo: 'codigo', nota: NOTA_ENVIADO };
    if (traido.telefono && traido.errorEnvio) return { tipo: 'error', mensaje: ERROR_ENVIO, volverA: 'telefono' };
    return { tipo: 'telefono' };
  });
  const espera = useEsperaReenvio();

  // Si el home ya mando el codigo, la espera del reenvio arranca al llegar.
  useEffect(() => {
    if (traido.telefono && traido.codigoEnviado) espera.iniciar();
    // Solo al montar: es el estado con el que se llego.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editandoTelefono = !telefono || (paso.tipo === 'error' && paso.volverA === 'telefono');
  const enviando = paso.tipo === 'enviando';
  const verificando = paso.tipo === 'verificando';
  const finalizando = paso.tipo === 'finalizando';
  const ocupado = enviando || verificando || finalizando;
  const errorEnCodigo = paso.tipo === 'error' && paso.volverA === 'codigo';
  const errorEnTelefono = paso.tipo === 'error' && paso.volverA === 'telefono';

  function cambiarTelefono() {
    setCodigo('');
    setMarcarFaltantes(false);
    setPaso({ tipo: 'telefono' });
    setTelefono('');
  }

  async function pedirCodigo(digitosNacionales: string) {
    const e164 = aE164(digitosNacionales);
    if (!e164) {
      setTelefono(digitosNacionales);
      setPaso({ tipo: 'error', mensaje: 'Ese número no tiene diez dígitos válidos.', volverA: 'telefono' });
      return;
    }

    setTelefono(digitosNacionales);
    setCodigo('');
    setMarcarFaltantes(false);
    setPaso({ tipo: 'enviando' });

    try {
      if (!supabaseEstaConfigurado()) throw new Error('supabase_no_configurado');
      const { error } = await obtenerSupabase().auth.signInWithOtp({ phone: e164 });
      if (error) throw error;
      espera.iniciar();
      setPaso({ tipo: 'codigo', nota: NOTA_ENVIADO });
    } catch {
      setPaso({ tipo: 'error', mensaje: ERROR_ENVIO, volverA: 'telefono' });
    }
  }

  async function verificarCodigo(e?: FormEvent) {
    e?.preventDefault();
    const e164 = aE164(telefono);
    if (!e164 || ocupado) return;
    if (codigo.length !== 6) {
      setMarcarFaltantes(true);
      setPaso({ tipo: 'error', mensaje: ERROR_INCOMPLETO, volverA: 'codigo' });
      return;
    }

    setMarcarFaltantes(false);
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

  const numeroOperador = import.meta.env.VITE_WHATSAPP_OPERADOR;
  const puedeReenviar = !editandoTelefono && !ocupado && espera.restante === 0;

  return (
    <div className="alta official-bg-guilloche text-neutral-800 min-h-screen font-jakarta antialiased flex flex-col selection:bg-emerald-600 selection:text-white">
      <header className="w-full max-w-4xl mx-auto px-4 sm:px-6 pt-6 pb-4 relative z-10 flex items-center justify-between">
        <Link
          className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-emerald-900 bg-white hover:bg-emerald-50 border border-emerald-300/80 hover:border-emerald-600 px-3.5 py-2 rounded-lg shadow-xs transition-all group"
          to="/"
        >
          <svg
            className="w-4 h-4 text-emerald-700 transform group-hover:-translate-x-1 transition-transform"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M10 19l-7-7m0 0l7-7m-7 7h18" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
          </svg>
          <span>Volver al inicio</span>
        </Link>
        <span className="text-xl font-extrabold tracking-tight text-brand-deep-forest">
          Flota<span className="text-brand-light-green">Bot</span>
        </span>
      </header>

      <main className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6 relative z-10 grow">
        <div className="expediente bg-white overflow-hidden relative">
          <div className="p-5 sm:p-10 space-y-8 bg-linear-to-b from-white via-emerald-50/20 to-white">
            <div className="space-y-3 pb-2 border-b border-emerald-100">
              <h1 className="text-3xl sm:text-4xl lg:text-[2.65rem] font-extrabold tracking-tight text-brand-deep-forest leading-tight">
                Agregar FlotaBot a tu WhatsApp
              </h1>
              <p className="text-neutral-600 text-sm sm:text-base leading-relaxed max-w-2xl">
                Dejás tu número, recibís un código por WhatsApp y lo escribís acá. Con eso queda creada tu
                organización y seguís en el chat, donde cargás la flota y los vehículos.
              </p>
            </div>

            {paso.tipo === 'listo' ? (
              <section className="expediente-seccion bg-[#fcfdfc] p-5 sm:p-7 space-y-4" aria-live="polite">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-brand-emerald shadow-inner shrink-0">
                    <IconoWhatsApp className="w-5 h-5" />
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold text-brand-deep-forest tracking-tight">
                    Listo. Seguí en WhatsApp
                  </h2>
                </div>
                <p className="text-sm sm:text-base text-neutral-600 leading-relaxed">
                  Tu organización ya está creada. Para cargar la flota y los vehículos, continuá la
                  conversación en WhatsApp.
                </p>
                {numeroOperador && (
                  <a
                    className="inline-flex items-center gap-2.5 px-6 py-3.5 bg-brand-emerald hover:bg-brand-dark-green text-white font-bold rounded-xl text-sm sm:text-base shadow-lg shadow-emerald-900/20 transition-all"
                    href={`https://wa.me/${numeroOperador}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <IconoWhatsApp className="w-4 h-4" />
                    <span>Abrir WhatsApp</span>
                  </a>
                )}
              </section>
            ) : (
              <>
                {/* PASO 01: el numero */}
                <section
                  className="expediente-seccion bg-[#fcfdfc] p-5 sm:p-6 relative overflow-hidden transition-colors"
                  aria-labelledby="titulo-telefono"
                >
                  <h2 id="titulo-telefono" className="sr-only">
                    Tu número de WhatsApp
                  </h2>
                  {editandoTelefono ? (
                    <FormularioTelefono
                      variante="expediente"
                      etiqueta="Tu WhatsApp, sin el 0 y sin el 15"
                      textoBoton="Recibir código por WhatsApp"
                      valorInicial={telefono}
                      error={errorEnTelefono && paso.tipo === 'error' ? paso.mensaje : undefined}
                      autoFocus
                      onEnviar={pedirCodigo}
                    />
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 shadow-inner shrink-0">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                            />
                          </svg>
                        </div>
                        <span className="text-xl sm:text-3xl font-bold tracking-tight text-brand-deep-forest font-plex truncate">
                          +54 9 {agruparTelefono(telefono)}
                        </span>
                      </div>
                      <button
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-white hover:bg-emerald-50 text-emerald-800 text-xs font-plex font-bold uppercase tracking-wider rounded-lg border-2 border-emerald-600/30 hover:border-emerald-600 shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        type="button"
                        title="Modificar número telefónico"
                        disabled={ocupado}
                        onClick={cambiarTelefono}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                          />
                        </svg>
                        <span>Cambiar</span>
                      </button>
                    </div>
                  )}
                </section>

                {/* PASO 02: el codigo */}
                <section
                  className={`expediente-seccion bg-white p-5 sm:p-7 relative shadow-xs ${
                    editandoTelefono ? 'opacity-60' : ''
                  }`}
                  aria-labelledby="titulo-codigo"
                >
                  <h2 id="titulo-codigo" className="text-xl sm:text-2xl font-bold text-brand-deep-forest tracking-tight mb-1">
                    Ingresá el código que te llegó
                  </h2>
                  <p className="text-xs sm:text-sm text-neutral-600 mb-6">
                    {editandoTelefono
                      ? 'Primero confirmá tu número: el código llega a ese WhatsApp.'
                      : '6 dígitos numéricos recibidos vía mensaje oficial en tu WhatsApp.'}
                  </p>

                  <form className="space-y-6" onSubmit={verificarCodigo} noValidate>
                    <div className="expediente-casilleros p-4 sm:p-7 flex items-center justify-center">
                      <CasillerosOtp
                        valor={codigo}
                        onCambio={(v) => {
                          setCodigo(v);
                          if (marcarFaltantes && v.length === 6) setMarcarFaltantes(false);
                        }}
                        disabled={editandoTelefono || ocupado}
                        autoFocus={!editandoTelefono && paso.tipo === 'codigo'}
                        marcarFaltantes={marcarFaltantes}
                      />
                    </div>

                    <div aria-live="polite" className="min-h-5">
                      {finalizando ? (
                        <p className="text-sm text-emerald-800">Creando tu organización…</p>
                      ) : errorEnCodigo && paso.tipo === 'error' ? (
                        <p className="text-sm text-red-700 font-medium" role="alert">
                          {paso.mensaje}
                        </p>
                      ) : paso.tipo === 'codigo' ? (
                        <p className="text-sm text-neutral-600">{paso.nota}</p>
                      ) : null}
                    </div>

                    <div className="expediente-divisor flex flex-col sm:flex-row items-center justify-between gap-5 pt-6">
                      <div className="flex flex-wrap items-center gap-2.5 text-xs sm:text-sm text-neutral-600">
                        <div className="w-6 h-6 rounded-full bg-brand-wa/15 flex items-center justify-center text-brand-wa shrink-0">
                          <IconoWhatsApp className="w-4 h-4" />
                        </div>
                        <span>¿No recibiste el mensaje?</span>
                        <button
                          className={`font-plex font-semibold transition-colors ${
                            puedeReenviar
                              ? 'text-emerald-700 hover:text-emerald-900 underline cursor-pointer'
                              : 'text-neutral-500 cursor-not-allowed'
                          }`}
                          type="button"
                          disabled={!puedeReenviar}
                          onClick={() => pedirCodigo(telefono)}
                        >
                          {enviando
                            ? 'Enviando...'
                            : espera.restante > 0
                              ? `Reenviar en ${formatearEspera(espera.restante)}`
                              : 'Reenviar código ahora'}
                        </button>
                      </div>

                      <button
                        className="w-full sm:w-auto px-8 py-3.5 bg-brand-emerald hover:bg-brand-dark-green active:bg-brand-dark-green text-white font-bold rounded-xl text-sm sm:text-base transition-all duration-150 flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-900/20 hover:shadow-xl hover:shadow-emerald-900/30 disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none"
                        type="submit"
                        disabled={editandoTelefono || ocupado}
                      >
                        {verificando || finalizando ? (
                          <>
                            <Spinner />
                            <span>{verificando ? 'Verificando...' : 'Creando tu organización...'}</span>
                          </>
                        ) : (
                          <>
                            <span>Verificar y continuar</span>
                            <IconoFlecha className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </section>
              </>
            )}
          </div>
        </div>
      </main>

      <footer className="w-full max-w-4xl mx-auto px-6 sm:px-8 py-6 text-xs text-neutral-500 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-emerald-800/10">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-600" aria-hidden="true" />
          <span>El código llega por WhatsApp. Si no te llega, revisá el número y reenvialo en un rato.</span>
        </div>
        <span>FlotaBot · Córdoba</span>
      </footer>
    </div>
  );
}
