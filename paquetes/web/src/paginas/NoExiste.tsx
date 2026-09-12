import { Link } from 'react-router-dom';

export function NoExiste() {
  return (
    <main>
      <h1>No existe</h1>
      <p>Esa direccion no es ninguna de las dos rutas de FlotaBot.</p>
      <p>
        <Link to="/">Ir al inicio</Link>
      </p>
    </main>
  );
}
