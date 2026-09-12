import { Link } from 'react-router-dom';

export function Inicio() {
  return (
    <main>
      <h1>FlotaBot</h1>
      <p>
        Ruta <code>/</code> — el home. Es un scaffold sin disenar: existe para
        que el deploy sirva algo en lugar de un 404. El texto que le habla a
        alguien que no conoce FlotaBot todavia no esta escrito.
      </p>
      <p>
        <Link to="/agregar">Agregar FlotaBot a WhatsApp</Link>
      </p>
    </main>
  );
}
