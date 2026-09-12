import { Link } from 'react-router-dom';

export function Agregar() {
  return (
    <main>
      <h1>Agregar FlotaBot a WhatsApp</h1>
      <p>
        Ruta <code>/agregar</code> — el alta por telefono verificado. Nada de
        esto funciona todavia: ni el formulario, ni el envio del codigo, ni la
        validacion. El envio va del lado del servidor, en una Edge Function,
        porque el token de WAHA no puede viajar al navegador.
      </p>
      <p>
        <Link to="/">Volver</Link>
      </p>
    </main>
  );
}
