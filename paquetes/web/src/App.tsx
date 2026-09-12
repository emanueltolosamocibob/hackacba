// =============================================================================
// Las dos rutas de PRODUCT.md, y nada mas.
//
// El comodin existe por el rewrite de Vercel: todo path inexistente recibe
// index.html, asi que sin el la app renderizaria una pantalla en blanco.
// =============================================================================

import { Route, Routes } from 'react-router-dom';
import { Inicio } from './paginas/Inicio.js';
import { Agregar } from './paginas/Agregar.js';
import { NoExiste } from './paginas/NoExiste.js';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Inicio />} />
      <Route path="/agregar" element={<Agregar />} />
      <Route path="*" element={<NoExiste />} />
    </Routes>
  );
}
