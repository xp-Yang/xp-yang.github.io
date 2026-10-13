import '@/components/ui/styles.css';
import './styles.css';
import { mountGravityApp } from './app/gravity-app.tsx';

const dispose = mountGravityApp(document.getElementById('app'));
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) dispose();
});
