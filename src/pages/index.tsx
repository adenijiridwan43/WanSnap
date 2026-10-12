import { VideoUploader } from '../components/videoUploader';

function Welcome() {
  // Single screen: WanSnap does one job, so there is nothing to navigate to.
  // The bottom tab bar was removed along with the placeholder Profile tab.
  return <VideoUploader />;
}

export default Welcome;