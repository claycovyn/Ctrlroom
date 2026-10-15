// QA harness: the create and join forms without their server actions (which need the Next server).
export function CreateCommunityForm() {
  return (
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
      <div>
        <label className="label" htmlFor="name">
          Name
        </label>
        <input id="name" name="name" className="input" placeholder="OpenCtrl" />
      </div>
      <button className="btn-primary w-full">Create community</button>
    </form>
  );
}

export function JoinCommunityForm() {
  return (
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
      <div>
        <label className="label" htmlFor="code">
          Invite link or code
        </label>
        <input id="code" name="code" className="input" placeholder="https://…/invite/abc123" />
      </div>
      <button className="btn-outline w-full">Join</button>
    </form>
  );
}
