import { Link } from 'react-router-dom';
import estilos from './NoExiste.module.css';

export function NoExiste() {
  return (
    <main className={`envoltorio ${estilos.pagina}`}>
      <h1 className={estilos.titulo}>Esa dirección no existe</h1>
      <p className={`${estilos.texto} prosa`}>
        FlotaBot tiene dos páginas: el inicio y el alta.
      </p>
      <p className={estilos.salida}>
        <Link to="/">Ir al inicio</Link>
      </p>
    </main>
  );
}
