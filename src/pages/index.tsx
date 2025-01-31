import { VideoUploader } from '../components/videoUploader'
import { HowToUse } from '../components/HowToUse/howToUse'

function Welcome() {

  return (
    <>
     <div className="min-h-screen bg-gray-100">
      <VideoUploader />
      <HowToUse />
    </div>
    </>
  )
}

export default Welcome
