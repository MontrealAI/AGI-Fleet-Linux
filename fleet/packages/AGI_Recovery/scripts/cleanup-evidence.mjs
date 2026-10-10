import '../shared/runtime/compute/bootstrap-entry.mjs';
import {cleanupMaintenanceMain} from '../shared/runtime/compute/cleanup-maintenance.mjs';
cleanupMaintenanceMain(['--role',"recovery",...process.argv.slice(2)]).catch(()=>{console.error('Cleanup maintenance stopped. Preserve the profile and all evidence for review.');process.exitCode=1;});
