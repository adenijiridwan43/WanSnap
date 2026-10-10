import './App.css'
import { ErrorBoundary } from './components/Error/errorboundary'
import Welcome from './pages'

function App() {
  return (
    <ErrorBoundary>
      <div className="app-container">
        <Welcome />
      </div>
    </ErrorBoundary>
  )
}

export default App