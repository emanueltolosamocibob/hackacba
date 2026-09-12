import { useNavigate } from 'react-router-dom';
import { Chat } from '../componentes/Chat';
import { CampoTelefono } from '../componentes/CampoTelefono';
import { CATALOGO } from '../datos/demostracion';
import estilos from './Inicio.module.css';

export function Inicio() {
  const navegar = useNavigate();

  /* El numero no viaja en la URL: va en el estado del router. Un telefono en
     una query string queda en el historial, en los logs y en el referer. */
  function seguir(telefono: string) {
    navegar('/agregar', { state: { telefono } });
  }

  return (
    <main className={estilos.pagina}>
      <div className="envoltorio">
        <section className={estilos.primero}>
          <h1 className={estilos.titular}>Tus flotas al día, con FlotaBot</h1>

          <div className={estilos.hilo}>
            <Chat />
          </div>

          <div className={estilos.accion}>
            <CampoTelefono
              etiqueta="Tu WhatsApp"
              textoBoton="Seguir"
              nota="Sin el 0 y sin el 15. Te lleva al alta, donde vas a recibir un código."
              onEnviar={seguir}
            />
          </div>

          <p className={estilos.ejemplo}>
            El hilo de arriba es un ejemplo inventado para mostrar cómo llegan los
            avisos. Los dominios y los importes no son de nadie; los organismos y el
            link de Rentas sí son los reales.
          </p>
        </section>

        <section className={estilos.seccion}>
          <h2 className={estilos.seccionTitulo}>Vencimientos</h2>
          <p className={`${estilos.seccionTexto} prosa`}>
            El catálogo es de Córdoba, no genérico: cada obligación viene con su
            organismo, su URL oficial de pago y las instrucciones del trámite ya
            cargadas.
          </p>

          <dl className={estilos.catalogo}>
            {CATALOGO.map((o) => (
              <div className={estilos.fila} key={o.codigo}>
                <dt className={estilos.filaNombre}>{o.nombre}</dt>
                <dd
                  className={`${estilos.filaOrganismo} ${
                    o.organismo ? '' : estilos.filaSinOrganismo
                  }`}
                >
                  {o.organismo ?? 'Sin organismo'}
                </dd>
                <dd className={estilos.filaAmbito}>{o.ambito}</dd>
              </div>
            ))}
          </dl>
        </section>

        <footer className={estilos.cierre}>
          <ul className={estilos.cierreLista}>
            <li>
              El código de verificación sale por una API no oficial de WhatsApp. No
              podemos garantizar que llegue, ni cuándo. Si no llega, se puede pedir de
              nuevo.
            </li>
            <li>
              El canal de WhatsApp todavía no está conectado, así que el alta no se
              puede completar de punta a punta.
            </li>
          </ul>
        </footer>
      </div>
    </main>
  );
}
