export function shouldIncrementalRoleLoad(forceRefresh: boolean, changedFiles?: readonly string[]): boolean {
    return !forceRefresh && !!changedFiles && changedFiles.length > 0;
}
