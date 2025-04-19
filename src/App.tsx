import './App.css'
import { ErrorBoundary } from './components/Error/errorboundary'
import Welcome from './pages'

function App() {

  return (
    <div>
      <ErrorBoundary>
        <Welcome/>
      </ErrorBoundary>
    </div>
  )
}

export default App
