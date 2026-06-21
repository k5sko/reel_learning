"""Pipeline stages. Each stage reads cached upstream artifacts and writes its
own JSON artifact to the job directory, so re-running a stage is resumable."""
