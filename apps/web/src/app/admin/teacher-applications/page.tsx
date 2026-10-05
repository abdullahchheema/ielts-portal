import { redirect } from 'next/navigation';

// Teacher applications live in the Applications screen's Teachers tab. This route gives them a nav entry.
export default function TeacherApplicationsRedirect() {
  redirect('/admin/applications?tab=teachers');
}
